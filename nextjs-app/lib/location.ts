export interface UserLocation {
  latitude: number
  longitude: number
}

let cachedLocation: UserLocation | null = null
let cachedAtMs = 0
const CACHE_TTL_MS = 5 * 60 * 1000

export async function getCurrentLocation(): Promise<UserLocation | null> {
  if (typeof window === 'undefined' || !navigator?.geolocation) {
    return null
  }

  const now = Date.now()
  if (cachedLocation && now - cachedAtMs < CACHE_TTL_MS) {
    return cachedLocation
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        cachedLocation = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        }
        cachedAtMs = Date.now()
        resolve(cachedLocation)
      },
      () => resolve(null),
      {
        enableHighAccuracy: false,
        timeout: 5000,
        maximumAge: 60 * 1000,
      }
    )
  })
}
