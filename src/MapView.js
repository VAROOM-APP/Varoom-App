import { useState, useEffect } from 'react';
import { GoogleMap, LoadScript, Marker } from '@react-google-maps/api';

const defaultCenter = {
  lat: 51.5074,
  lng: -0.1278
};

function MapView({ events }) {
  const [userLocation, setUserLocation] = useState(defaultCenter);
  const [selectedEvent, setSelectedEvent] = useState(null);

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
        <LoadScript googleMapsApiKey="AIzaSyBs3eAymhwEl1dKlALubuxwS69ZkdSf5_g">
          <GoogleMap
            mapContainerStyle={{ width: '100%', height: '500px' }}
            center={userLocation}
            zoom={10}
          >
            {events.map(event => (
              <Marker
                key={event.id}
                position={{ lat: event.latitude, lng: event.longitude }}
                title={event.title}
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