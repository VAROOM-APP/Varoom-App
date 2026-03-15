import { useState, useEffect } from 'react';
import { GoogleMap, LoadScript, Marker } from '@react-google-maps/api';

const defaultCenter = { lat: 51.5074, lng: -0.1278 };

const getMarkerIcon = (eventType) => {
  const colors = { meets: '#e63946', auctions: '#f4a261', races: '#2a9d8f', autojumbles: '#457b9d', default: '#888888' };
  const emojis = { meets: '🏎', auctions: '💸', races: '🏁', autojumbles: '🔧', default: '📍' };
  const color = colors[eventType] || colors.default;
  const emoji = emojis[eventType] || emojis.default;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50" viewBox="0 0 40 50"><path d="M20 0C9 0 0 9 0 20c0 15 20 30 20 30S40 35 40 20C40 9 31 0 20 0z" fill="' + color + '"/><circle cx="20" cy="20" r="13" fill="white"/><text x="20" y="26" text-anchor="middle" font-size="16" fill="black">' + emoji + '</text></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
};

function MapView({ events, selectedEvent, setSelectedEvent, mapExpanded, setMapExpanded, mapFullScreen, setMapFullScreen, getCalendarUrl }) {
  const [userLocation, setUserLocation] = useState(defaultCenter);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [windowHeight, setWindowHeight] = useState(window.innerHeight);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        position => setUserLocation({ lat: position.coords.latitude, lng: position.coords.longitude }),
        () => console.log('Location access denied')
      );
    }
    const handleResize = () => setWindowHeight(window.innerHeight);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const mapHeightPx = mapFullScreen ? windowHeight : Math.floor(windowHeight * 0.5);

  return (
    <div>
      <button className={mapExpanded ? 'map-toggle-btn open' : 'map-toggle-btn'} onClick={() => { setMapExpanded(!mapExpanded); if (mapFullScreen) setMapFullScreen(false); }}>
        {mapExpanded ? '▲ Hide Map' : '▼ See Map'}
      </button>
      {mapExpanded && (
        <div style={{ width: '100%', height: mapHeightPx + 'px', display: 'flex', position: 'relative' }}>
          {selectedEvent && (
            <div className={mapFullScreen ? 'event-sidebar sidebar-overlay' : 'event-sidebar'}>
              <button className="close-btn" onClick={() => setSelectedEvent(null)}>✕</button>
              <span className="event-type">{selectedEvent.event_type}</span>
              <h2>{selectedEvent.title}</h2>
              <div className="sidebar-meta">
                <p>📅 {selectedEvent.date}</p>
                <p>🕐 {selectedEvent.start_time}</p>
                <p>📍 {selectedEvent.location_name}</p>
                <p>🚗 {selectedEvent.vehicle_type}</p>
              </div>
              {selectedEvent.description && <p className="sidebar-description">{selectedEvent.description}</p>}
              <a href={'https://www.google.com/maps/dir/?api=1&destination=' + selectedEvent.latitude + ',' + selectedEvent.longitude} target="_blank" rel="noreferrer" className="sidebar-link directions-btn">🗺 Get Directions</a>
              <a href={getCalendarUrl(selectedEvent)} target="_blank" rel="noreferrer" className="sidebar-link calendar-btn">📅 Add to Calendar</a>
              {selectedEvent.external_link && <a href={selectedEvent.external_link} target="_blank" rel="noreferrer" className="sidebar-link">More Info / Tickets</a>}
            </div>
          )}
          <div style={{ flex: 1, position: 'relative', height: mapHeightPx + 'px' }}>
            <button className="fullscreen-btn" onClick={() => setMapFullScreen(!mapFullScreen)}>
              {mapFullScreen ? '⤡ Exit Full Screen' : '⤢ Full Screen'}
            </button>
            <LoadScript googleMapsApiKey="AIzaSyBs3eAymhwEl1dKlALubuxwS69ZkdSf5_g" onLoad={() => setMapLoaded(true)} onError={() => console.log('Maps failed to load')}>
              <GoogleMap mapContainerStyle={{ width: '100%', height: mapHeightPx + 'px' }} center={selectedEvent ? { lat: selectedEvent.latitude, lng: selectedEvent.longitude } : userLocation} zoom={selectedEvent ? 13 : 10} mapTypeId="satellite">
                {mapLoaded && events.map(event => (
                  <Marker key={event.id} position={{ lat: event.latitude, lng: event.longitude }} title={event.title} icon={{ url: getMarkerIcon(event.event_type), scaledSize: new window.google.maps.Size(40, 50), anchor: new window.google.maps.Point(20, 50) }} onClick={() => setSelectedEvent(event)} />
                ))}
              </GoogleMap>
            </LoadScript>
          </div>
        </div>
      )}
    </div>
  );
}

export default MapView;