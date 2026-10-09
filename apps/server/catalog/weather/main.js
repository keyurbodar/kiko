// Open-Meteo needs no key: https://open-meteo.com/en/docs
const SKY = {
  0: "clear", 1: "mostly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "fog",
  51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 61: "light rain", 63: "rain", 65: "heavy rain",
  71: "light snow", 73: "snow", 75: "heavy snow", 80: "showers", 81: "showers", 82: "heavy showers",
  95: "thunderstorm", 96: "thunderstorm with hail", 99: "thunderstorm with hail",
}
const sky = (code) => SKY[code] ?? `code ${code}`
const round = (n) => Math.round(n)

export const tools = {
  async weather({ place, days = 3 }, yuki) {
    const geo = await yuki.fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=${encodeURIComponent(place)}`)
    const hit = geo.json?.results?.[0]
    if (!hit) return `no place called ${place}`
    const n = Math.min(Math.max(Number(days) || 3, 1), 7)
    const query = [
      `latitude=${hit.latitude}`, `longitude=${hit.longitude}`,
      "current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m",
      "daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
      "timezone=auto", `forecast_days=${n}`,
    ].join("&")
    const forecast = await yuki.fetch(`https://api.open-meteo.com/v1/forecast?${query}`)
    const now = forecast.json?.current
    const daily = forecast.json?.daily
    if (!now || !daily) return "open-meteo did not answer"
    const where = hit.country ? `${hit.name}, ${hit.country}` : hit.name
    const lines = [`${where}: ${round(now.temperature_2m)}°c, feels ${round(now.apparent_temperature)}°c, ${sky(now.weather_code)}, wind ${round(now.wind_speed_10m)} km/h`]
    for (let i = 0; i < daily.time.length; i++) {
      lines.push(`${daily.time[i]}: ${sky(daily.weather_code[i])}, ${round(daily.temperature_2m_min[i])} to ${round(daily.temperature_2m_max[i])}°c, rain ${daily.precipitation_probability_max[i] ?? 0}%`)
    }
    return lines.join("\n")
  },
}
