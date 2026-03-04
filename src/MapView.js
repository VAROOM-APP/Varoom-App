import { useState, useEffect } from 'react';
import { GoogleMap, LoadScript, Marker } from '@react-google-maps/api';

const defaultCenter = {
  lat: 51.5074,
  lng: -0.1278
};

const getMarkerIcon = (eventType) => {
  const colors = {
    meets: '#e63946',
    auctions: '#f4a261',
    races: '#2a9d8f',
    autojumbles: '#457b9d',
    default: '#888888'
  };

  const emojis = {
    meets: '🏎',
    auctions: '🔨',
    races: '🏁',
    autojumbles: '🔧',
    default: '📍'
  };

  const color = colors[eventType] || colors.default;
  const emoji = emojis[eventType] || emojis.default;

  return `data:image/svg+xml,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
      <rect x="0" y="0" width="36" height="36" rx="8" ry="8" fill="${color}"/>
      <text x="18" y="24" text-anchor="middle" font-size="18" fill="white">${emoji}</text>
    </svg>
  `)}`;
};

function MapView({ events, selectedEvent, setSelectedEvent }) {
  const [userLocation, setUserLocation] = useState(defaultCenter);
  const [mapLoaded, setMapLoaded] = useState(false);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        position => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        () => {
          console.log('Location access denied, using default');
        }
      );
    }
  }, []);

  return (
    <div style={{ display: 'flex', height: '500px' }}>
      {selectedEvent && (
        <div className="event-sidebar">
          <button className="close-btn" onClick={() => setSelectedEvent(null)}>x</button>
          <span className="event-type">{selectedEvent.event_type}</span>
          <h2>{selectedEvent.title}</h2>
          <div className="sidebar-meta">
            <p>Date: {selectedEvent.date}</p>
            <p>Time: {selectedEvent.start_time}</p>
            <p>Location: {selectedEvent.location_name}</p>
            <p>Vehicle: {selectedEvent.vehicle_type}</p>
          </div>
          {selectedEvent.description && (
            <p className="sidebar-description">{selectedEvent.description}</p>
          )}
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${selectedEvent.latitude},${selectedEvent.longitude}`} target="_blank" rel="noreferrer" className="sidebar-link directions-btn">
            Get Directions
          </a>
          {selectedEvent.external_link && (
            <a href={selectedEvent.external_link} target="_blank" rel="noreferrer" className="sidebar-link">
              More Info / Tickets
            </a>
          )}
        </div>
      )}
      <div style={{ flex: 1 }}>
        <LoadScript
          googleMapsApiKey="AIzaSyBs3eAymhwEl1dKlALubuxwS69ZkdSf5_g"
          onLoad={() => setMapLoaded(true)}
        >
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '500px' }}
            center={selectedEvent ? { lat: selectedEvent.latitude, lng: selectedEvent.longitude } : userLocation}
            zoom={selectedEvent ? 13 : 10}
          >
            {mapLoaded && events.map(event => (
              <Marker
                key={event.id}
                position={{ lat: event.latitude, lng: event.longitude }}
                title={event.title}
                icon={{
                  url: getMarkerIcon(event.event_type),
                  scaledSize: new window.google.maps.Size(32, 32),
                  anchor: new window.google.maps.Point(16, 16)
                }}
                onClick={() => setSelectedEvent(event)}
              />
            ))}
          </GoogleMap>
        </LoadScript>
      </div>
    </div>
  );
}

export default MapView;