use serde::Serialize;
use regex::Regex;

#[derive(Serialize, Clone)]
struct Channel {
    id: usize,
    name: String,
    logo: String,
    group: String,
    url: String,
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .invoke_handler(tauri::generate_handler![fetch_m3u])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
