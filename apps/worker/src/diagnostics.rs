use std::{
    collections::BTreeSet,
    env,
    ffi::{c_void, OsStr, OsString},
    fs,
    io::{self, Read},
    os::windows::ffi::{OsStrExt, OsStringExt},
    path::{Path, PathBuf},
    ptr::null_mut,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use crate::workspace;

const WORKSPACE_MAGIC: &[u8; 8] = b"XPLWSP01";
const WORKSPACE_VERSION: u32 = 1;
const MB_OK: u32 = 0;
const MB_ICONERROR: u32 = 0x0000_0010;
const MB_ICONINFORMATION: u32 = 0x0000_0040;

#[link(name = "user32")]
unsafe extern "system" {
    fn MessageBoxW(window: *mut c_void, text: *const u16, caption: *const u16, kind: u32) -> i32;
}

pub fn has_test_folder(arguments: &[OsString]) -> bool {
    arguments.iter().any(|arg| {
        arg.to_string_lossy().eq_ignore_ascii_case("--test-folder")
            || arg.to_string_lossy().to_ascii_lowercase().starts_with("--test-folder=")
    })
}

pub fn run_test_folder(arguments: &[OsString]) -> io::Result<i32> {
    let debug = arguments.iter().any(|arg| is_debug_argument(arg));
    if !debug {
        show(
            "--test-folder is a production diagnostic and is intentionally locked behind --debug.\n\nExample:\nxplorer.exe --debug --test-folder \"C:\\Users\\Merge\"",
            "Xplorer debug command rejected",
            true,
        );
        return Ok(64);
    }

    let folder = match parse_test_folder(arguments) {
        Some(folder) => PathBuf::from(folder),
        None => {
            show(
                "Missing folder path.\n\nUsage:\nxplorer.exe --debug --test-folder \"C:\\path\\to\\folder\"",
                "Xplorer folder diagnostic",
                true,
            );
            return Ok(64);
        }
    };

    let folder = match folder.canonicalize() {
        Ok(folder) if folder.is_dir() => folder,
        Ok(_) => {
            show("The requested test path is not a directory.", "Xplorer folder diagnostic", true);
            return Ok(66);
        }
        Err(error) => {
            show(
                &format!("Could not resolve the requested folder:\n{}\n\n{error}", folder.display()),
                "Xplorer folder diagnostic",
                true,
            );
            return Ok(66);
        }
    };

    let local = env::var_os("LOCALAPPDATA").ok_or_else(|| {
        io::Error::new(io::ErrorKind::NotFound, "LOCALAPPDATA is not available")
    })?;
    let index_dir = PathBuf::from(&local).join("Xplorer").join("Index");
    let log_dir = PathBuf::from(local).join("Xplorer").join("Logs");
    fs::create_dir_all(&index_dir)?;
    fs::create_dir_all(&log_dir)?;

    let disk_started = Instant::now();
    let disk_names = enumerate_direct_names(&folder)?;
    let disk_elapsed = disk_started.elapsed();

    // Force a fresh hot-workspace snapshot in this diagnostic process so the result does not depend
    // on whether the background worker happened to notice the most recent UI hint yet.
    let hint = index_dir.join("workspace.hint");
    let temp_hint = index_dir.join(format!("workspace.hint.debug.{}.tmp", std::process::id()));
    fs::write(&temp_hint, folder.as_os_str().to_string_lossy().as_bytes())?;
    if hint.exists() {
        let _ = fs::remove_file(&hint);
    }
    fs::rename(&temp_hint, &hint)?;

    let index_started = Instant::now();
    let rebuilt = workspace::refresh_hot_workspace(&index_dir, None)?;
    let index_build_elapsed = index_started.elapsed();

    let decode_started = Instant::now();
    let decoded = decode_workspace_direct_names(&index_dir.join("workspace.xwidx"), &folder)?;
    let decode_elapsed = decode_started.elapsed();

    let missing: Vec<_> = disk_names.difference(&decoded.names).cloned().collect();
    let extra: Vec<_> = decoded.names.difference(&disk_names).cloned().collect();
    let pass = decoded.root.eq_ignore_ascii_case(folder.to_string_lossy().as_ref())
        && missing.is_empty()
        && extra.is_empty();

    let report = format!(
        "Xplorer folder diagnostic\r\n\
         =========================\r\n\
         Folder: {}\r\n\
         Result: {}\r\n\
         Disk direct children: {}\r\n\
         Workspace-index direct children: {}\r\n\
         Workspace root: {}\r\n\
         Workspace snapshot rebuilt: {}\r\n\
         Disk enumeration: {:.3} ms\r\n\
         Workspace rebuild: {:.3} ms\r\n\
         Workspace decode: {:.3} ms\r\n\
         Missing from index: {}\r\n\
         Extra in index: {}\r\n\r\n\
         Missing sample: {:?}\r\n\
         Extra sample: {:?}\r\n",
        folder.display(),
        if pass { "PASS" } else { "FAIL" },
        disk_names.len(),
        decoded.names.len(),
        decoded.root,
        rebuilt,
        disk_elapsed.as_secs_f64() * 1000.0,
        index_build_elapsed.as_secs_f64() * 1000.0,
        decode_elapsed.as_secs_f64() * 1000.0,
        missing.len(),
        extra.len(),
        missing.iter().take(12).collect::<Vec<_>>(),
        extra.iter().take(12).collect::<Vec<_>>(),
    );

    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    let log_path = log_dir.join(format!("debug-folder-{timestamp}.log"));
    fs::write(&log_path, report.as_bytes())?;

    show(
        &format!(
            "{}\n\nFolder: {}\nDisk items: {}\nIndexed items: {}\n\nReport:\n{}",
            if pass { "Folder backend/index test PASSED." } else { "Folder backend/index test FAILED." },
            folder.display(),
            disk_names.len(),
            decoded.names.len(),
            log_path.display(),
        ),
        "Xplorer folder diagnostic",
        !pass,
    );

    Ok(if pass { 0 } else { 2 })
}

struct DecodedWorkspace {
    root: String,
    names: BTreeSet<String>,
}

fn enumerate_direct_names(folder: &Path) -> io::Result<BTreeSet<String>> {
    let mut names = BTreeSet::new();
    for entry in fs::read_dir(folder)? {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };
        names.insert(entry.file_name().to_string_lossy().to_ascii_lowercase());
    }
    Ok(names)
}

fn decode_workspace_direct_names(path: &Path, expected_root: &Path) -> io::Result<DecodedWorkspace> {
    let mut bytes = Vec::new();
    fs::File::open(path)?.read_to_end(&mut bytes)?;
    let mut cursor = 0usize;

    if take(&bytes, &mut cursor, 8)? != WORKSPACE_MAGIC.as_ref() {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "workspace index magic mismatch"));
    }
    let version = read_u32(&bytes, &mut cursor)?;
    if version != WORKSPACE_VERSION {
        return Err(io::Error::new(io::ErrorKind::InvalidData, format!("workspace index version {version} is unsupported")));
    }
    let _timestamp = read_u64(&bytes, &mut cursor)?;
    let root_units = read_u32(&bytes, &mut cursor)? as usize;
    let root = read_utf16(&bytes, &mut cursor, root_units)?;
    let root_path = PathBuf::from(&root);
    if root_path != expected_root {
        // Keep decoding so the report can show the unexpected root rather than only a generic error.
    }

    let mut names = BTreeSet::new();
    while cursor < bytes.len() {
        let start = cursor;
        let record_length = read_u32(&bytes, &mut cursor)? as usize;
        if record_length < 32 || start.checked_add(record_length).filter(|end| *end <= bytes.len()).is_none() {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "workspace index contains an invalid record length"));
        }
        let _flags = take(&bytes, &mut cursor, 4)?;
        let _attributes = read_u32(&bytes, &mut cursor)?;
        let _size = read_u64(&bytes, &mut cursor)?;
        let _last_write = read_u64(&bytes, &mut cursor)?;
        let units = read_u32(&bytes, &mut cursor)? as usize;
        let relative = read_utf16(&bytes, &mut cursor, units)?;
        if cursor != start + record_length {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "workspace index record size mismatch"));
        }

        let relative_path = PathBuf::from(relative);
        if relative_path.components().count() == 1 {
            if let Some(name) = relative_path.file_name() {
                names.insert(name.to_string_lossy().to_ascii_lowercase());
            }
        }
    }

    Ok(DecodedWorkspace { root, names })
}

fn parse_test_folder(arguments: &[OsString]) -> Option<OsString> {
    for (index, argument) in arguments.iter().enumerate() {
        let text = argument.to_string_lossy();
        if text.eq_ignore_ascii_case("--test-folder") {
            return arguments.get(index + 1).cloned();
        }
        if let Some((key, value)) = text.split_once('=') {
            if key.eq_ignore_ascii_case("--test-folder") && !value.is_empty() {
                return Some(OsString::from(value));
            }
        }
    }
    None
}

fn is_debug_argument(argument: &OsStr) -> bool {
    matches!(
        argument.to_string_lossy().to_ascii_lowercase().as_str(),
        "--debug" | "-debug" | "--diagnose"
    )
}

fn take<'a>(bytes: &'a [u8], cursor: &mut usize, length: usize) -> io::Result<&'a [u8]> {
    let end = cursor.checked_add(length).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "index cursor overflow"))?;
    if end > bytes.len() {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "workspace index ended early"));
    }
    let result = &bytes[*cursor..end];
    *cursor = end;
    Ok(result)
}

fn read_u32(bytes: &[u8], cursor: &mut usize) -> io::Result<u32> {
    let raw: [u8; 4] = take(bytes, cursor, 4)?.try_into().unwrap();
    Ok(u32::from_le_bytes(raw))
}

fn read_u64(bytes: &[u8], cursor: &mut usize) -> io::Result<u64> {
    let raw: [u8; 8] = take(bytes, cursor, 8)?.try_into().unwrap();
    Ok(u64::from_le_bytes(raw))
}

fn read_utf16(bytes: &[u8], cursor: &mut usize, units: usize) -> io::Result<String> {
    let raw = take(bytes, cursor, units.checked_mul(2).ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "UTF-16 length overflow"))?)?;
    let mut wide = Vec::with_capacity(units);
    for pair in raw.chunks_exact(2) {
        wide.push(u16::from_le_bytes([pair[0], pair[1]]));
    }
    Ok(OsString::from_wide(&wide).to_string_lossy().into_owned())
}

fn show(text: &str, caption: &str, error: bool) {
    let text = wide(text);
    let caption = wide(caption);
    unsafe {
        MessageBoxW(
            null_mut(),
            text.as_ptr(),
            caption.as_ptr(),
            MB_OK | if error { MB_ICONERROR } else { MB_ICONINFORMATION },
        );
    }
}

fn wide(value: &str) -> Vec<u16> {
    OsStr::new(value).encode_wide().chain(Some(0)).collect()
}
