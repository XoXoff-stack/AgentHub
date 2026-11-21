use serde::Serialize;
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFile {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub size: Option<u64>,
}

fn project_root(root: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(root)
        .canonicalize()
        .map_err(|error| format!("Cannot open project folder: {error}"))?;
    if !path.is_dir() {
        return Err("Project root must be a directory.".into());
    }
    Ok(path)
}

fn safe_target(root: &Path, relative: &str, allow_missing: bool) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative_path.as_os_str().is_empty()
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("The requested path is invalid.".into());
    }

    let joined = root.join(relative_path);
    let metadata = fs::symlink_metadata(&joined);
    let canonical = match metadata {
        Err(error) if allow_missing && error.kind() == std::io::ErrorKind::NotFound => {
            let parent = joined
                .parent()
                .ok_or_else(|| "Invalid parent directory".to_string())?;
            let parent = parent
                .canonicalize()
                .map_err(|error| format!("Parent directory is unavailable: {error}"))?;
            parent.join(
                joined
                    .file_name()
                    .ok_or_else(|| "Invalid filename".to_string())?,
            )
        }
        Err(error) => return Err(format!("File is unavailable: {error}")),
        Ok(metadata) => {
            if metadata.file_type().is_symlink() {
                return Err(
                    "Symbolic links cannot be opened or modified in the project editor.".into(),
                );
            }
            joined
                .canonicalize()
                .map_err(|error| format!("File is unavailable: {error}"))?
        }
    };

    if !canonical.starts_with(root) {
        return Err("Access outside the selected project is blocked.".into());
    }
    Ok(canonical)
}

pub fn list_project_files(root: &str) -> Result<Vec<ProjectFile>, String> {
    let root = project_root(root)?;
    let mut result = Vec::new();
    walk(&root, &root, 0, &mut result)?;
    result.sort_by(|left, right| {
        right
            .is_directory
            .cmp(&left.is_directory)
            .then_with(|| left.path.to_lowercase().cmp(&right.path.to_lowercase()))
    });
    Ok(result)
}

fn walk(
    root: &Path,
    current: &Path,
    depth: usize,
    output: &mut Vec<ProjectFile>,
) -> Result<(), String> {
    if depth > 6 || output.len() >= 4_000 {
        return Ok(());
    }

    let entries = fs::read_dir(current).map_err(|error| format!("Cannot read folder: {error}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if matches!(name.as_str(), ".git" | ".cache" | ".next" | ".turbo") {
            continue;
        }

        let metadata = match fs::symlink_metadata(&path) {
            Ok(value) => value,
            Err(_) => continue,
        };
        if metadata.file_type().is_symlink() {
            continue;
        }

        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let is_directory = metadata.is_dir();
        output.push(ProjectFile {
            name,
            path: relative,
            is_directory,
            size: if is_directory {
                None
            } else {
                Some(metadata.len())
            },
        });

        if is_directory {
            walk(root, &path, depth + 1, output)?;
        }
        if output.len() >= 4_000 {
            break;
        }
    }
    Ok(())
}

pub fn read_project_file(root: &str, relative: &str) -> Result<String, String> {
    let root = project_root(root)?;
    let target = safe_target(&root, relative, false)?;
    let metadata = fs::metadata(&target).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("The selected path is not a file.".into());
    }
    if metadata.len() > 2 * 1024 * 1024 {
        return Err("Files larger than 2 MB are not opened in the integrated editor.".into());
    }
    fs::read_to_string(target)
        .map_err(|error| format!("Cannot read this file as UTF-8 text: {error}"))
}

pub fn write_project_file(root: &str, relative: &str, content: &str) -> Result<(), String> {
    let root = project_root(root)?;
    let target = safe_target(&root, relative, true)?;
    if let Some(parent) = target.parent() {
        if !parent.starts_with(&root) {
            return Err("Access outside the selected project is blocked.".into());
        }
    }
    fs::write(target, content).map_err(|error| format!("Cannot save file: {error}"))
}

pub fn delete_project_file(root: &str, relative: &str) -> Result<(), String> {
    let root = project_root(root)?;
    let target = safe_target(&root, relative, false)?;
    if target == root {
        return Err("The project root cannot be deleted.".into());
    }
    let metadata = fs::symlink_metadata(&target).map_err(|error| error.to_string())?;
    if metadata.is_dir() {
        return Err("Deleting directories is not enabled in this version.".into());
    }
    fs::remove_file(target).map_err(|error| format!("Cannot delete file: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{read_project_file, write_project_file};
    use std::{fs, path::PathBuf};

    fn temporary_root() -> PathBuf {
        std::env::temp_dir().join(format!("agenthub-test-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn file_access_stays_inside_the_selected_project() {
        let root = temporary_root();
        fs::create_dir_all(&root).unwrap();
        let root_string = root.to_string_lossy().to_string();

        write_project_file(&root_string, "notes.txt", "AgentHub").unwrap();
        assert_eq!(read_project_file(&root_string, "notes.txt").unwrap(), "AgentHub");
        assert!(read_project_file(&root_string, "../outside.txt").is_err());

        fs::remove_dir_all(root).unwrap();
    }
}
