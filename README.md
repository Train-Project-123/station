# 🚉 Indian Railway Station Finder — TEST BUILD

Geo-detection test app for Indian Railway stations using Expo React Native + Node.js + MongoDB.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile | React Native (Expo SDK 54) |
| Styling | NativeWind v4 (Tailwind CSS) |
| Location | expo-location |
| Backend | Node.js + Express |
| Database | MongoDB (Mongoose) |
| Distance | Haversine Formula |
| Toasts | Custom Sonner-inspired system |

---

## 🗂️ Project Structure

```
train/
├── backend/               # Express API + MongoDB
│   ├── index.js           # Server entry point
│   ├── seed.js            # Database seeder
│   ├── models/
│   │   └── Station.js     # Mongoose model (2dsphere index)
│   └── routes/
│       └── stations.js    # /api/stations/* routes
│
└── mobile/                # React Native Expo App
    ├── App.js             # Root entry point
    ├── global.css         # NativeWind v4 CSS
    ├── tailwind.config.js
    ├── metro.config.js
    ├── components/
    │   ├── TrackingScreen.js  # Main geo-tracking screen
    │   ├── Toast.js           # Toast notification system
    │   └── ui.js              # shadcn/ui-inspired components
    └── utils/
        ├── haversine.js       # Distance calculation
        └── api.js             # Backend API client
```

---

## 🚀 Setup & Run

### 1. Start MongoDB
Make sure MongoDB is running locally:
```
mongod
```

### 2. Start Backend
```bash
cd backend
npm install         # first time only
npm run seed        # seeds Kakkanchery station into DB
npm start           # starts server on port 5000
```

Verify: `http://localhost:5000/api/stations/nearby?lat=11.152122&lng=75.893304&radius=5000`

### 3. Start Mobile App
```bash
cd mobile
npm start           # opens Expo DevTools
```

Then scan the QR code with Expo Go app on your phone.

---

## 📍 Test Station

| Field | Value |
|-------|-------|
| Name | Kakkanchery |
| Code | KAKJ |
| Zone | Southern Railway |
| Division | Palakkad |
| State | Kerala |
| Latitude | 11.152122 |
| Longitude | 75.893304 |

---

## 🧠 Core Logic

### Geo-Fencing Flow

```
App opens → GPS acquired
     ↓
Haversine distance to ALL stations
     ↓
< 500m?  ──YES──→ "You are near Kakkanchery"  → 30s interval
   │
   NO
   ↓
"You are outside the boundary" → 5min interval
```

### Interval Switching

| State | Check Interval |
|-------|---------------|
| Inside 500m | Every **30 seconds** |
| Outside 500m | Every **5 minutes** |

### Toast Messages

| Event | Toast |
|-------|-------|
| First location fetch | "Location fetched successfully" |
| Enter 500m zone | "You are near Kakkanchery" |
| Exit 500m zone | "You are outside the boundary" |
| GPS failure | "Failed to get location" |

---

## 🔌 API Reference

### GET `/api/stations/nearby`

Query Params:
- `lat` — latitude (required)
- `lng` — longitude (required)
- `radius` — search radius in meters (default: 5000)

Example:
```
GET /api/stations/nearby?lat=11.152122&lng=75.893304&radius=5000
```

Response:
```json
{
  "success": true,
  "count": 1,
  "userLocation": { "lat": 11.152122, "lng": 75.893304 },
  "searchRadius": 5000,
  "stations": [
    {
      "stationName": "Kakkanchery",
      "stationCode": "KAKJ",
      "zone": "Southern Railway",
      "division": "Palakkad",
      "state": "Kerala",
      "distanceMeters": 0,
      "isWithin500m": true
    }
  ]
}
```

---

## ⚠️ Device Testing Notes

- **Android Emulator**: Backend URL is `http://10.0.2.2:5000`
- **Physical Device**: Change `API_BASE_URL` in `mobile/utils/api.js` to your machine's local IP
  - e.g., `http://192.168.1.100:5000`
- **Backend Fallback**: If backend is unavailable, the app uses a hardcoded Kakkanchery station for offline testing

---

## 🎨 Design Tokens

```
Background:  #09090b
Card:        #18181b
Border:      #27272a
Primary:     #6366f1
Text:        #fafafa
Muted:       #a1a1aa
```
