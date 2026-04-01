import { useState, useEffect } from 'react';
import { GoogleMap, Marker, Circle } from '@react-google-maps/api';

const defaultCenter = { lat: 51.5074, lng: -0.1278 };

const getMarkerIcon = (eventType) => {
  const colors = { meets: '#e63946', auctions: '#f4a261', races: '#2a9d8f', autojumbles: '#457b9d', default: '#888888' };
  const emojis = { meets: '🏎', auctions: '💸', races: '🏁', autojumbles: '🔧', default: '📍' };
  const color = colors[eventType] || colors.default;
  const emoji = emojis[eventType] || emojis.default;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="50" viewBox="0 0 40 50"><path d="M20 0C9 0 0 9 0 20c0 15 20 30 20 30S40 35 40 20C40 9 31 0 20 0z" fill="' + color + '"/><circle cx="20" cy="20" r="13" fill="white"/><text x="20" y="26" text-anchor="middle" font-size="16" fill="black">' + emoji + '</text></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
};

const MILES_TO_METRES = 1609.34;

function MapView({ events, selectedEvent, setSelectedEvent, mapExpanded, setMapExpanded, mapFullScreen, setMapFullScreen, getCalendarUrl, mapsLoaded, filterLocation, distanceEnabled, distanceMiles }) {
  const [userLocation, setUserLocation] = useState(defaultCenter);
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
  const circleCenter = filterLocation ? { lat: filterLocation.lat, lng: filterLocation.lng } : userLocation;

  return (
    <div>
      <button
        className={mapExpanded ? 'map-toggle-btn open' : 'map-toggle-btn'}
        onClick={() => {
          setMapExpanded(!mapExpanded);
          if (mapFullScreen) setMapFullScreen(false);
          if (mapExpanded) setSelectedEvent(null);
        }}
      >
        {mapExpanded ? '▲ Hide Map' : '▼ See Map'}
      </button>

      {mapExpanded && (
        <div style={{ width: '100%', height: mapHeightPx + 'px', position: 'relative' }}>
          <button className="fullscreen-btn" onClick={() => setMapFullScreen(!mapFullScreen)}>
            {mapFullScreen ? '⤡ Exit Full Screen' : '⤢ Full Screen'}
          </button>

          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '100%' }}
            center={selectedEvent ? { lat: selectedEvent.latitude, lng: selectedEvent.longitude } : circleCenter}
            zoom={selectedEvent ? 13 : 10}
            mapTypeId="satellite"
            onClick={() => setSelectedEvent(null)}
          >
            {mapsLoaded && events.map(event => (
              <Marker
                key={event.id}
                position={{ lat: event.latitude, lng: event.longitude }}
                title={event.title}
                icon={{ url: getMarkerIcon(event.event_type), scaledSize: new window.google.maps.Size(40, 50), anchor: new window.google.maps.Point(20, 50) }}
                onClick={() => setSelectedEvent(event)}
              />
            ))}
            {mapsLoaded && distanceEnabled && circleCenter && (
              <Circle
                center={circleCenter}
                radius={distanceMiles * MILES_TO_METRES}
                options={{
                  strokeColor: '#e63946',
                  strokeOpacity: 0.9,
                  strokeWeight: 2,
                  fillColor: '#e63946',
                  fillOpacity: 0.1,
                }}
              />
            )}
          </GoogleMap>

          {/* Bottom sheet overlay */}
          {selectedEvent && (
            <div className="map-bottom-sheet" onClick={e => e.stopPropagation()}>
              <div className="map-bottom-sheet-handle" />
              <div className="map-bottom-sheet-content">
                <button className="close-btn" onClick={() => setSelectedEvent(null)}>✕</button>
                <span className="event-type">{selectedEvent.event_type}</span>
                <h2>{selectedEvent.title}</h2>
                <div className="sidebar-meta">
                  <p>📅 {selectedEvent.date}</p>
                  <p>🕐 {selectedEvent.start_time}</p>
                  <p>📍 {selectedEvent.location_name}</p>
                  <p>🚗 {selectedEvent.vehicle_type}</p>
                  {selectedEvent.is_recurring && <p>🔄 {selectedEvent.recurrence}</p>}
                </div>
                {selectedEvent.description && <p className="sidebar-description">{selectedEvent.description}</p>}
                <div className="map-bottom-sheet-actions">
                  <a href={'https://www.google.com/maps/dir/?api=1&destination=' + selectedEvent.latitude + ',' + selectedEvent.longitude} target="_blank" rel="noreferrer" className="sidebar-link directions-btn">🗺 Get Directions</a>
                  <a href={getCalendarUrl(selectedEvent)} target="_blank" rel="noreferrer" className="sidebar-link calendar-btn">📅 Add to Calendar</a>
                  {selectedEvent.external_link && <a href={selectedEvent.external_link} target="_blank" rel="noreferrer" className="sidebar-link">More Info / Tickets</a>}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default MapView;