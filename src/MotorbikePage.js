import { useState } from 'react';

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function MotorbikePage({ events, savedEvents, toggleSaveEvent, getCalendarUrl, onNavigate, userLocation }) {
  const [selectedEvent, setSelectedEvent] = useState(null);

  const motorbikeEvents = events.filter(e =>
    e.vehicle_type === 'motorbike' || e.vehicle_type === 'both'
  ).sort((a, b) => new Date(a.date) - new Date(b.date));

  const nearbyEvents = userLocation
    ? motorbikeEvents.filter(e => e.latitude && e.longitude &&
        haversineDistance(userLocation.lat, userLocation.lng, e.latitude, e.longitude) <= 50)
    : [];

  return (
    <div className="homepage">
      <div className="hero-wrapper moto-hero-wrapper">
        <div className="hero">
          <div className="hero-content">
            <p className="hero-eyebrow">🏍 UK Motorbike Events</p>
            <h2>Find Your<br />Next Ride.</h2>
            <p className="hero-sub">Rallies, track days, autojumbles and meets — all in one place.</p>
            <div className="hero-buttons">
              <button onClick={() => onNavigate('events')} className="hero-btn primary">All Events</button>
              <button onClick={() => onNavigate('home')} className="hero-btn secondary">← Back</button>
            </div>
          </div>
        </div>
      </div>

      {nearbyEvents.length > 0 && (
        <div className="homepage-section">
          <div className="section-header">
            <h3>🏍 Near You</h3>
            <span className="section-line" />
          </div>
          <div className="recent-events">
            {nearbyEvents.slice(0, 5).map(event => (
              <div key={event.id}>
                <div
                  className={`event-card ${selectedEvent?.id === event.id ? 'selected' : ''}`}
                  onClick={() => setSelectedEvent(selectedEvent?.id === event.id ? null : event)}
                >
                  <div className="event-card-header">
                    <h2>{event.title}</h2>
                    <button onClick={(e) => { e.stopPropagation(); toggleSaveEvent(event.id); }} className={`save-btn ${savedEvents.includes(event.id) ? 'saved' : ''}`}>
                      {savedEvents.includes(event.id) ? '♥' : '♡'}
                    </button>
                  </div>
                  <div className="event-meta">
                    <span>{event.date}</span>
                    <span>{event.location_name}</span>
                    <span className="event-type">{event.event_type}</span>
                    {event.is_verified && <span className="verified-badge">✓ Verified</span>}
                  </div>
                </div>
                {selectedEvent?.id === event.id && (
                  <div className="event-detail-panel">
                    {event.is_verified && <div className="verified-badge">✓ Verified Event</div>}
                    <div className="sidebar-meta">
                      <p>📅 {event.date}</p>
                      <p>🕐 {event.start_time}</p>
                      {event.location_name && <p>📍 {event.location_name}</p>}
                    </div>
                    {event.description && <p className="sidebar-description">{event.description}</p>}
                    <div className="event-detail-actions">
                      <a href={'https://www.google.com/maps/dir/?api=1&destination=' + event.latitude + ',' + event.longitude} target="_blank" rel="noreferrer" className="sidebar-link directions-btn">🗺 Directions</a>
                      <a href={getCalendarUrl(event)} target="_blank" rel="noreferrer" className="sidebar-link calendar-btn">📅 Calendar</a>
                      {event.external_link && <a href={event.external_link} target="_blank" rel="noreferrer" className="sidebar-link tickets-btn">🎟 More Info</a>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="homepage-section">
        <div className="section-header">
          <h3>All Motorbike Events</h3>
          <span className="section-line" />
        </div>
        {motorbikeEvents.length === 0 ? (
          <p style={{ color: '#666' }}>No motorbike events found yet.</p>
        ) : (
          <div className="recent-events">
            {motorbikeEvents.map(event => (
              <div key={event.id}>
                <div
                  className={`event-card ${selectedEvent?.id === event.id ? 'selected' : ''}`}
                  onClick={() => setSelectedEvent(selectedEvent?.id === event.id ? null : event)}
                >
                  <div className="event-card-header">
                    <h2>{event.title}</h2>
                    <button onClick={(e) => { e.stopPropagation(); toggleSaveEvent(event.id); }} className={`save-btn ${savedEvents.includes(event.id) ? 'saved' : ''}`}>
                      {savedEvents.includes(event.id) ? '♥' : '♡'}
                    </button>
                  </div>
                  <div className="event-meta">
                    <span>{event.date}</span>
                    <span>{event.location_name}</span>
                    <span className="event-type">{event.event_type}</span>
                    {event.is_verified && <span className="verified-badge">✓ Verified</span>}
                  </div>
                </div>
                {selectedEvent?.id === event.id && (
                  <div className="event-detail-panel">
                    {event.is_verified && <div className="verified-badge">✓ Verified Event</div>}
                    <div className="sidebar-meta">
                      <p>📅 {event.date}</p>
                      <p>🕐 {event.start_time}</p>
                      {event.location_name && <p>📍 {event.location_name}</p>}
                    </div>
                    {event.description && <p className="sidebar-description">{event.description}</p>}
                    <div className="event-detail-actions">
                      <a href={'https://www.google.com/maps/dir/?api=1&destination=' + event.latitude + ',' + event.longitude} target="_blank" rel="noreferrer" className="sidebar-link directions-btn">🗺 Directions</a>
                      <a href={getCalendarUrl(event)} target="_blank" rel="noreferrer" className="sidebar-link calendar-btn">📅 Calendar</a>
                      {event.external_link && <a href={event.external_link} target="_blank" rel="noreferrer" className="sidebar-link tickets-btn">🎟 More Info</a>}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <footer className="site-footer">
        <button onClick={() => onNavigate('events')}>All Events</button>
        <button onClick={() => onNavigate('home')}>Home</button>
      </footer>
    </div>
  );
}

export default MotorbikePage;