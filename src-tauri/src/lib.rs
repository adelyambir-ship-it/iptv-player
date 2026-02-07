use serde::{Serialize, Deserialize};
use regex::Regex;
use std::sync::Mutex;
use std::process::{Child, Command, Stdio};
use std::path::PathBuf;

#[derive(Serialize, Clone)]
struct Channel {
    id: usize,
    name: String,
    logo: String,
    group: String,
    url: String,
}

#[derive(Serialize, Clone)]
struct Subtitle {
    id: String,
    language: String,
    release_name: String,
    download_url: String,
}

// Fetch and parse M3U, return channels as JSON
#[tauri::command]
async fn fetch_m3u(url: String) -> Result<Vec<Channel>, String> {
    println!("Fetching M3U from: {}", url);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .connect_timeout(std::time::Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .redirect(reqwest::redirect::Policy::limited(10))
        .build()
        .map_err(|e| format!("Client error: {}", e))?;

    println!("Sending request...");

    let response = client.get(&url)
        .header("Accept", "*/*")
        .header("Accept-Encoding", "gzip, deflate")
        .send()
        .await
        .map_err(|e| {
            println!("Request failed: {}", e);
            format!("Failed to fetch: {}", e)
        })?;

    println!("Got response, status: {}", response.status());

    if !response.status().is_success() {
        return Err(format!("HTTP error: {}", response.status()));
    }

    println!("Reading response body...");

    let content = response.text()
        .await
        .map_err(|e| {
            println!("Failed to read body: {}", e);
            format!("Failed to read: {}", e)
        })?;

    println!("Content size: {} bytes", content.len());

    if content.is_empty() {
        return Err("Empty response received".to_string());
    }

    // Parse M3U
    println!("Parsing M3U...");
    let channels = parse_m3u(&content);
    println!("Parsed {} channels", channels.len());

    if channels.is_empty() {
        return Err("No channels found in M3U file".to_string());
    }

    Ok(channels)
}

fn parse_m3u(content: &str) -> Vec<Channel> {
    let mut channels = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    let name_re = Regex::new(r#"tvg-name="([^"]*)""#).unwrap();
    let logo_re = Regex::new(r#"tvg-logo="([^"]*)""#).unwrap();
    let group_re = Regex::new(r#"group-title="([^"]*)""#).unwrap();

    let mut current_info: Option<(String, String, String)> = None;

    for line in lines {
        let line = line.trim();

        if line.starts_with("#EXTINF:") {
            let name = name_re.captures(line)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();

            let logo = logo_re.captures(line)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
                .unwrap_or_default();

            let group = group_re.captures(line)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
                .unwrap_or_else(|| "Diger".to_string());

            // Get name after last comma
            let display_name = line.rfind(',')
                .map(|i| line[i+1..].trim().to_string())
                .unwrap_or(name.clone());

            current_info = Some((
                if display_name.is_empty() { name } else { display_name },
                logo,
                group
            ));
        } else if !line.is_empty() && !line.starts_with('#') {
            if let Some((name, logo, group)) = current_info.take() {
                channels.push(Channel {
                    id: channels.len(),
                    name: if name.is_empty() { "Bilinmeyen".to_string() } else { name },
                    logo,
                    group,
                    url: line.to_string(),
                });
            }
        }
    }

    channels
}

// Search subtitles from Subdl (free API)
#[tauri::command]
async fn search_subtitles(query: String) -> Result<Vec<Subtitle>, String> {
    println!("Searching subtitles for: {}", query);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| format!("Client error: {}", e))?;

    // Use Subdl API
    let url = format!(
        "https://api.subdl.com/api/v1/subtitles?film_name={}&languages=tr",
        urlencoding::encode(&query)
    );

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Search failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }

    #[derive(Deserialize)]
    struct SubdlResponse {
        subtitles: Option<Vec<SubdlItem>>,
    }

    #[derive(Deserialize)]
    struct SubdlItem {
        release_name: Option<String>,
        url: Option<String>,
        language: Option<String>,
    }

    let data: SubdlResponse = response.json().await
        .map_err(|e| format!("Parse error: {}", e))?;

    let subtitles: Vec<Subtitle> = data.subtitles
        .unwrap_or_default()
        .iter()
        .take(10)
        .filter_map(|item| {
            Some(Subtitle {
                id: item.url.clone()?,
                language: item.language.clone().unwrap_or_else(|| "tr".to_string()),
                release_name: item.release_name.clone().unwrap_or_else(|| "Unknown".to_string()),
                download_url: item.url.clone()?,
            })
        })
        .collect();

    println!("Found {} subtitles", subtitles.len());
    Ok(subtitles)
}

// Download subtitle file
#[tauri::command]
async fn download_subtitle(file_id: String) -> Result<String, String> {
    println!("Downloading subtitle from: {}", file_id);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
        .build()
        .map_err(|e| format!("Client error: {}", e))?;

    // file_id is the direct URL for Subdl
    let download_url = if file_id.starts_with("http") {
        file_id
    } else {
        format!("https://dl.subdl.com{}", file_id)
    };

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    // Subdl returns a ZIP file, we need to extract the SRT
    let bytes = response.bytes().await
        .map_err(|e| format!("Read failed: {}", e))?;

    // Try to extract SRT from ZIP
    let subtitle_content = extract_srt_from_zip(&bytes)
        .unwrap_or_else(|_| String::from_utf8_lossy(&bytes).to_string());

    println!("Downloaded {} bytes", subtitle_content.len());
    Ok(subtitle_content)
}

fn extract_srt_from_zip(data: &[u8]) -> Result<String, String> {
    use std::io::{Read, Cursor};

    let reader = Cursor::new(data);
    let mut archive = zip::ZipArchive::new(reader)
        .map_err(|e| format!("ZIP error: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("ZIP file error: {}", e))?;

        let name = file.name().to_lowercase();
        if name.ends_with(".srt") {
            let mut content = String::new();
            file.read_to_string(&mut content)
                .map_err(|e| format!("Read error: {}", e))?;
            return Ok(content);
        }
    }

    Err("No SRT file found in ZIP".to_string())
}

// ==========================================
// FFmpeg Transcoding + Local HLS Server
// ==========================================

static FFMPEG_PROCESS: std::sync::OnceLock<Mutex<Option<Child>>> = std::sync::OnceLock::new();
static SERVER_STARTED: std::sync::OnceLock<std::sync::atomic::AtomicBool> = std::sync::OnceLock::new();

fn get_ffmpeg_process() -> &'static Mutex<Option<Child>> {
    FFMPEG_PROCESS.get_or_init(|| Mutex::new(None))
}

fn is_server_started() -> &'static std::sync::atomic::AtomicBool {
    SERVER_STARTED.get_or_init(|| std::sync::atomic::AtomicBool::new(false))
}

// Get HLS temp directory (cross-platform)
fn get_hls_path() -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        std::env::temp_dir().join("iptv-hls")
    }
    #[cfg(not(target_os = "windows"))]
    {
        PathBuf::from("/tmp/iptv-hls")
    }
}

// Start ffmpeg transcoding to HLS
#[tauri::command]
async fn start_stream(url: String) -> Result<String, String> {
    println!("Starting stream transcoding: {}", url);

    // Stop previous ffmpeg first
    stop_stream_internal().await?;

    // Use cross-platform temp path
    let hls_path = get_hls_path();
    let _ = std::fs::create_dir_all(&hls_path);

    // Clean old files
    if let Ok(entries) = std::fs::read_dir(&hls_path) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }

    // Start HLS server if not running
    start_hls_server_fixed().await;

    // Small delay to ensure server is ready
    tokio::time::sleep(tokio::time::Duration::from_millis(300)).await;

    let playlist_path = hls_path.join("stream.m3u8");
    let segment_pattern = hls_path.join("segment%d.ts");

    println!("HLS output: {}", playlist_path.display());

    // Use system ffmpeg
    let mut cmd = Command::new("ffmpeg");
    cmd.args([
        "-y",
        "-loglevel", "error",
        "-fflags", "+genpts+discardcorrupt+nobuffer",
        "-flags", "low_delay",
        "-reconnect", "1",
        "-reconnect_streamed", "1",
        "-reconnect_delay_max", "2",
        "-analyzeduration", "500000",
        "-probesize", "500000",
        "-i", &url,
        "-c:v", "copy",
        "-c:a", "aac",
        "-ar", "44100",
        "-b:a", "128k",
        "-f", "hls",
        "-hls_time", "1",
        "-hls_list_size", "5",
        "-hls_flags", "delete_segments+split_by_time",
        "-hls_segment_filename", segment_pattern.to_str().unwrap(),
        "-start_number", "0",
        playlist_path.to_str().unwrap(),
    ])
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let child = cmd.spawn()
        .map_err(|e| format!("FFmpeg not found: {}. Please install ffmpeg.", e))?;

    println!("FFmpeg started with PID: {:?}", child.id());

    if let Ok(mut guard) = get_ffmpeg_process().lock() {
        *guard = Some(child);
    }

    // Wait for first segment
    for i in 0..12 {
        tokio::time::sleep(tokio::time::Duration::from_millis(250)).await;
        if playlist_path.exists() {
            let has_segment = std::fs::read_dir(&hls_path)
                .map(|entries| entries.filter_map(|e| e.ok()).any(|e| e.path().extension().map_or(false, |ext| ext == "ts")))
                .unwrap_or(false);
            if has_segment {
                println!("HLS ready after {}ms", (i + 1) * 250);
                break;
            }
        }
    }

    Ok("http://127.0.0.1:9876/hls/stream.m3u8".to_string())
}

// Fixed path HLS server
async fn start_hls_server_fixed() {
    use axum::{Router, routing::get_service};
    use tower_http::services::ServeDir;
    use tower_http::cors::{CorsLayer, Any};
    use std::sync::atomic::Ordering;

    if is_server_started().load(Ordering::SeqCst) {
        return;
    }
    is_server_started().store(true, Ordering::SeqCst);

    tokio::spawn(async move {
        let hls_path = get_hls_path();
        let _ = std::fs::create_dir_all(&hls_path);

        let cors = CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any);

        let app = Router::new()
            .nest_service("/hls", get_service(ServeDir::new(&hls_path)))
            .layer(cors);

        println!("Starting HLS server on http://127.0.0.1:9876");

        if let Ok(listener) = tokio::net::TcpListener::bind("127.0.0.1:9876").await {
            let _ = axum::serve(listener, app).await;
        }
    });
}

// Internal stop without tauri command
async fn stop_stream_internal() -> Result<(), String> {
    // Kill stored process
    if let Ok(mut guard) = get_ffmpeg_process().lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    // Kill orphaned ffmpeg processes
    #[cfg(unix)]
    {
        let _ = std::process::Command::new("pkill")
            .args(["-f", "iptv-hls"])
            .output();
    }

    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/F", "/IM", "ffmpeg.exe"])
            .output();
    }

    // Clean HLS directory
    let hls_path = get_hls_path();
    if let Ok(entries) = std::fs::read_dir(&hls_path) {
        for entry in entries.flatten() {
            let _ = std::fs::remove_file(entry.path());
        }
    }

    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    Ok(())
}

// Stop ffmpeg - tauri command wrapper
#[tauri::command]
async fn stop_stream() -> Result<(), String> {
    stop_stream_internal().await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![
            fetch_m3u,
            search_subtitles,
            download_subtitle,
            start_stream,
            stop_stream
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
