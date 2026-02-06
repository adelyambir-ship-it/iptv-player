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

// Search subtitles from OpenSubtitles
#[tauri::command]
async fn search_subtitles(query: String) -> Result<Vec<Subtitle>, String> {
    println!("Searching subtitles for: {}", query);

    let client = reqwest::Client::new();

    // Use OpenSubtitles API
    let response = client
        .get("https://api.opensubtitles.com/api/v1/subtitles")
        .header("Api-Key", "bnQIdGiVnMRVwG7d0YFgIHnCdAt3QXHD")
        .header("User-Agent", "IPTV Player v1.0")
        .query(&[
            ("query", query.as_str()),
            ("languages", "tr"),
        ])
        .send()
        .await
        .map_err(|e| format!("Search failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("API error: {}", response.status()));
    }

    let data: OpenSubtitlesResponse = response.json().await
        .map_err(|e| format!("Parse error: {}", e))?;

    let subtitles: Vec<Subtitle> = data.data.iter().take(10).map(|item| {
        Subtitle {
            id: item.attributes.files.first()
                .map(|f| f.file_id.to_string())
                .unwrap_or_default(),
            language: item.attributes.language.clone(),
            release_name: item.attributes.release.clone().unwrap_or_else(|| "Unknown".to_string()),
            download_url: format!("https://api.opensubtitles.com/api/v1/download"),
        }
    }).collect();

    println!("Found {} subtitles", subtitles.len());
    Ok(subtitles)
}

// Download subtitle file
#[tauri::command]
async fn download_subtitle(file_id: String) -> Result<String, String> {
    println!("Downloading subtitle: {}", file_id);

    let client = reqwest::Client::new();

    // Request download link
    let response = client
        .post("https://api.opensubtitles.com/api/v1/download")
        .header("Api-Key", "bnQIdGiVnMRVwG7d0YFgIHnCdAt3QXHD")
        .header("User-Agent", "IPTV Player v1.0")
        .header("Content-Type", "application/json")
        .body(format!(r#"{{"file_id": {}}}"#, file_id))
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    #[derive(Deserialize)]
    struct DownloadResponse {
        link: String,
    }

    let download_info: DownloadResponse = response.json().await
        .map_err(|e| format!("Parse error: {}", e))?;

    // Download actual subtitle file
    let subtitle_content = client
        .get(&download_info.link)
        .send()
        .await
        .map_err(|e| format!("Subtitle download failed: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Read failed: {}", e))?;

    println!("Downloaded {} bytes", subtitle_content.len());
    Ok(subtitle_content)
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
