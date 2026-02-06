use serde::{Serialize, Deserialize};
use regex::Regex;

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

#[derive(Deserialize)]
struct OpenSubtitlesResponse {
    data: Vec<OpenSubtitlesItem>,
}

#[derive(Deserialize)]
struct OpenSubtitlesItem {
    id: String,
    attributes: SubtitleAttributes,
}

#[derive(Deserialize)]
struct SubtitleAttributes {
    language: String,
    release: Option<String>,
    files: Vec<SubtitleFile>,
}

#[derive(Deserialize)]
struct SubtitleFile {
    file_id: i64,
}

// Fetch and parse M3U, return channels as JSON
#[tauri::command]
async fn fetch_m3u(url: String) -> Result<Vec<Channel>, String> {
    println!("Fetching M3U from: {}", url);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Client error: {}", e))?;

    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch: {}", e))?;

    println!("Got response, status: {}", response.status());

    let content = response.text()
        .await
        .map_err(|e| format!("Failed to read: {}", e))?;

    println!("Content size: {} bytes", content.len());

    // Parse M3U
    let channels = parse_m3u(&content);
    println!("Parsed {} channels", channels.len());

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![fetch_m3u, search_subtitles, download_subtitle])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
