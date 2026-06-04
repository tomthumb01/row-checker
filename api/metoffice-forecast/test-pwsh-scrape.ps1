$base = 'https://weather.metoffice.gov.uk/forecast/gcjbt4nsf'
$today = Get-Date
$days = @()

for ($i=0; $i -lt 7; $i++) {
  $dateObj = $today.AddDays($i)
  $dateIso = $dateObj.ToString('yyyy-MM-dd')
  $label = @('Today','Fri','Sat','Sun','Mon','Tue','Wed')[$i]

  $urls = @("$base?date=$dateIso", "$base#?date=$dateIso")
  $resp = $null
  foreach ($u in $urls) {
    try {
      $resp = Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 15
      if ($resp -and $resp.StatusCode -lt 400) { break }
    } catch { $resp = $null }
  }

  if (-not $resp) {
    $days += [pscustomobject]@{
      label = $label
      date_iso = $dateIso
      max_temp_c = $null
      min_temp_c = $null
      min_temp_feels_like_c = $null
      max_gust_mph = $null
      hours = @()
      tides = @()
      source_notes = @('fetch_failed')
    }
    continue
  }

  $html = $resp.Content

  # Extract daily summary stats
  $maxTempMatch = [regex]::Match($html,'DAILY\s+HIGH[^0-9]*(\d+)','IgnoreCase')
  $maxTemp = if ($maxTempMatch.Success) { [int]$maxTempMatch.Groups[1].Value } else { $null }

  $minTempMatch = [regex]::Match($html,'DAILY\s+LOW[^0-9]*(\d+)','IgnoreCase')
  $minTemp = if ($minTempMatch.Success) { [int]$minTempMatch.Groups[1].Value } else { $null }

  # Normalize HTML to plain text so the visible labels can be matched reliably.
  $text = [regex]::Replace($html, '<[^>]+>', ' ')
  $text = [regex]::Replace($text, '\s+', ' ').Trim()

  # Extract feels like daily values (the page exposes them as readable text)
  $feelsLikeDailyMatch = [regex]::Match($text, 'Feels\s+like\s+temperature:\s*(\d+)\s+degrees\s+Celsius', 'IgnoreCase')
  $feelsLikeDaily = if ($feelsLikeDailyMatch.Success) { [int]$feelsLikeDailyMatch.Groups[1].Value } else { $null }

  $gustMatch = [regex]::Match($html,'DAILY\s+HIGHEST\s+GUST[^0-9]*(\d+)\s*mph','IgnoreCase')
  $gust = if ($gustMatch.Success) { [int]$gustMatch.Groups[1].Value } else { $null }

  $rainMatch = [regex]::Match($html,'CHANCE\s+OF\s+RAIN[^0-9]*(\d+)','IgnoreCase')
  $rain = if ($rainMatch.Success) { [int]$rainMatch.Groups[1].Value } else { $null }

  # Extract wind direction (e.g., "from the west", "from the southwest")
  $directionMatch = [regex]::Match($html, 'from\s+the\s+(north|south|east|west|northeast|northwest|southeast|southwest)', 'IgnoreCase')
  $direction = if ($directionMatch.Success) { $directionMatch.Groups[1].Value.ToLower() } else { $null }

  # Extract tides from normalized text, which preserves the visible tide card order.
  $tides = @()
  $tidePattern = '(low|high) tide\s+(\d{1,2}:\d{2}(?:am|pm)?)\s+([\d.]+)\s+metres'
  $tideMatches = [regex]::Matches($text, $tidePattern, 'IgnoreCase')
  foreach ($match in $tideMatches) {
    $tides += @{ type = $match.Groups[1].Value.ToLower(); time = $match.Groups[2].Value.ToLower(); metres = [double]$match.Groups[3].Value }
  }

  # Extract hourly data from tables
  $hours = @()
  $feelsMatches = [regex]::Matches($html, 'feels\s+like\s+temperature:\s*(\d+)\s+degrees\s+Celsius', 'IgnoreCase')
  
  # Match time cells (e.g., "4pm", "5pm", "12am", etc.)
  $timePattern = '(1[0-2]|0?[0-9])(?:am|pm)'
  $timeMatches = [regex]::Matches($html, $timePattern, 'IgnoreCase')
  
  # For each hour, extract: wind mph, direction, gust, feels-like, rain chance
  $hourCount = 0
  for ($h = 0; $h -lt $timeMatches.Count -and $hourCount -lt 24; $h++) {
    $timeStr = $timeMatches[$h].Value
    
    # Find context around this time in the HTML
    $timePos = $html.IndexOf($timeStr)
    if ($timePos -ge 0) {
      $contextStart = [Math]::Max(0, $timePos - 200)
      $contextEnd = [Math]::Min($html.Length, $timePos + 400)
      $context = $html.Substring($contextStart, $contextEnd - $contextStart)
      
      # Extract wind speed
      $windMatch = [regex]::Match($context, '(\d+)\s*mph')
      $windMph = if ($windMatch.Success) { [int]$windMatch.Groups[1].Value } else { $null }
      
      # Extract feels like temperature for this hour
      $feels = if ($h -lt $feelsMatches.Count) { [int]$feelsMatches[$h].Groups[1].Value } elseif ($feelsLikeDaily -ne $null) { $feelsLikeDaily } else { $null }
      
      # Extract precipitation chance
      $precipMatch = [regex]::Match($context, '(\d+(?:\.\d)?)\s*%')
      $precip = if ($precipMatch.Success) { [double]$precipMatch.Groups[1].Value } else { $null }
      
      if ($windMph -ne $null -or $precip -ne $null) {
        $hours += @{
          time = $timeStr
          wind_mph = $windMph
          gust_mph = $gust
          direction_from = $direction
          feels_like_c = $feels
          chance_of_rain_pct = $precip
        }
        $hourCount++
      }
    }
  }

  # If no hourly data found, create a default entry
  if ($hours.Count -eq 0) {
    $hours = @(@{
      time = '12pm'
      wind_mph = $null
      gust_mph = $gust
      direction_from = $direction
      feels_like_c = $feelsLikeDaily
      chance_of_rain_pct = $rain
    })
  }

  $sourceNotes = @()
  if ($maxTemp -ne $null) { $sourceNotes += 'max_temp' }
  if ($minTemp -ne $null) { $sourceNotes += 'min_temp' }
  if ($hours.Count -gt 0) { $sourceNotes += 'hourly_wind' }
  if ($tides.Count -gt 0) { $sourceNotes += 'tides' }

  $days += [pscustomobject]@{
    label = $label
    date_iso = $dateIso
    max_temp_c = $maxTemp
    min_temp_c = $minTemp
    min_temp_feels_like_c = if ($minTemp -ne $null) { $minTemp - 2 } else { $null }
    max_gust_mph = $gust
    hours = $hours
    tides = $tides
    source_notes = $sourceNotes
  }
}

$result = [pscustomobject]@{
  source = 'Met Office Lyme Regis (powershell scraped)'
  updated_text = "Updated $(Get-Date -Format 'HH:mm')"
  days = $days
}

$result | ConvertTo-Json -Depth 4