import { useEffect, useState, useCallback } from 'react';
import { LoadScript } from '@react-google-maps/api';
import supabase from './supabaseClient';
import './App.css';
import MapView from './MapView';
import Auth from './Auth';
import SavedEvents from './SavedEvents';
import HomePage from './HomePage';

const GOOGLE_MAPS_API_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY;
const LIBRARIES = ['places'];

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function App() {
  const [events, setEvents] = useState([]);
  const [filterType, setFilterType] = useState('all');
  const [filterVehicle, setFilterVehicle] = useState('all');
  const [filterMarque, setFilterMarque] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState('');
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [savedEvents, setSavedEvents] = useState([]);
  const [currentPage, setCurrentPage] = useState('home');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [mapFullScreen, setMapFullScreen] = useState(false);
  const [mapsLoaded, setMapsLoaded] = useState(false);

  // Location + distance filter
  const [userLocation, setUserLocation] = useState(null);
  const [filterLocation, setFilterLocation] = useState(null); // { lat, lng, label }
  const [locationInput, setLocationInput] = useState('');
  const [distanceEnabled, setDistanceEnabled] = useState(false);
  const [distanceMiles, setDistanceMiles] = useState(50);
  const [geocodeError, setGeocodeError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
      if (session?.user) fetchSavedEvents(session.user.id);
    });
    supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setShowAuth(false);
      if (session?.user) fetchSavedEvents(session.user.id);
    });
    async function getEvents() {
      const { data } = await supabase.from('events').select('*');
      setEvents(data || []);
    }
    getEvents();

    // Get GPS location
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        position => {
          const loc = { lat: position.coords.latitude, lng: position.coords.longitude, label: 'My Location' };
          setUserLocation(loc);
          setFilterLocation(loc);
        },
        () => console.log('Location access denied')
      );
    }
  }, []);

  const fetchSavedEvents = async (userId) => {
    const { data } = await supabase.from('saved_events').select('event_id').eq('user_id', userId);
    setSavedEvents(data ? data.map(d => d.event_id) : []);
  };

  const toggleSaveEvent = async (eventId) => {
    if (!user) { setShowAuth(true); return; }
    const isSaved = savedEvents.includes(eventId);
    if (isSaved) {
      await supabase.from('saved_events').delete().eq('user_id', user.id).eq('event_id', eventId);
      setSavedEvents(savedEvents.filter(id => id !== eventId));
    } else {
      await supabase.from('saved_events').insert({ user_id: user.id, event_id: eventId });
      setSavedEvents([...savedEvents, eventId]);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSavedEvents([]);
    setCurrentPage('home');
  };

  const geocodeLocation = useCallback(async () => {
    if (!locationInput.trim()) {
      // Reset to GPS
      if (userLocation) {
        setFilterLocation(userLocation);
        setGeocodeError('');
      }
      return;
    }
    if (!mapsLoaded) return;
    setGeocodeError('');
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ address: locationInput + ', UK' }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const { lat, lng } = results[0].geometry.location;
        setFilterLocation({ lat: lat(), lng: lng(), label: results[0].formatted_address.split(',')[0] });
      } else {
        setGeocodeError('Location not found');
      }
    });
  }, [locationInput, mapsLoaded, userLocation]);

  const marques = ['all', ...new Set(events.filter(e => e.marque).map(e => e.marque))];

  const filteredEvents = events.filter(event => {
    const matchesType = filterType === 'all' || event.event_type === filterType;
    const matchesVehicle = filterVehicle === 'all' || event.vehicle_type === filterVehicle;
    const matchesMarque = filterMarque === 'all' || event.marque === filterMarque;
    const matchesStart = !startDate || event.date >= startDate;
    const matchesEnd = !endDate || event.date <= endDate;
    const matchesSearch = !searchQuery ||
      event.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.location_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      event.marque?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesDistance = !distanceEnabled || !filterLocation || !event.latitude || !event.longitude
      ? true
      : haversineDistance(filterLocation.lat, filterLocation.lng, event.latitude, event.longitude) <= distanceMiles;
    return matchesType && matchesVehicle && matchesMarque && matchesStart && matchesEnd && matchesSearch && matchesDistance;
  });

  const getCalendarUrl = (event) => {
    const date = event.date.replace(/-/g, '');
    const startTime = event.start_time ? event.start_time.replace(/:/g, '').slice(0, 6) : '090000';
    const endHour = String(parseInt(event.start_time ? event.start_time.slice(0, 2) : '09') + 2).padStart(2, '0');
    const endTime = endHour + (event.start_time ? event.start_time.slice(3, 5) : '00') + '00';
    const location = event.location_name + (event.latitude ? ' (' + event.latitude + ',' + event.longitude + ')' : '');
    const details = (event.description || 'Event found on Varoom') + (event.external_link ? '\n\nMore info: ' + event.external_link : '') + '\n\nFind more events at varoom.app';
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(event.title) + '&dates=' + date + 'T' + startTime + 'Z/' + date + 'T' + endTime + 'Z&location=' + encodeURIComponent(location) + '&details=' + encodeURIComponent(details);
  };

  return (
    <LoadScript googleMapsApiKey={GOOGLE_MAPS_API_KEY} libraries={LIBRARIES} onLoad={() => setMapsLoaded(true)}>
      <div>
        <div className="header">
          <h1 onClick={() => { setCurrentPage('home'); setShowAuth(false); }} style={{ cursor: 'pointer' }}>Varoom</h1>
          <div className="header-right">
            <input
              type="text"
              placeholder="Search events..."
              value={searchQuery}
              onChange={e => {
                setSearchQuery(e.target.value);
                if (currentPage !== 'events') setCurrentPage('events');
              }}
              className="search-input header-search"
            />
            <button onClick={() => setCurrentPage('events')} className={`header-btn ${currentPage === 'events' ? 'active' : ''}`}>Events</button>
            {user ? (
              <>
                <button onClick={() => setCurrentPage(currentPage === 'saved' ? 'home' : 'saved')} className={`header-btn ${currentPage === 'saved' ? 'active' : ''}`}>
                  ♥ Saved
                </button>
                <button onClick={handleSignOut} className="header-btn">Sign Out</button>
              </>
            ) : (
              <button onClick={() => setShowAuth(true)} className="header-btn">Sign In</button>
            )}
          </div>
        </div>

        {showAuth && (
          <div>
            <button onClick={() => setShowAuth(false)} className="header-btn" style={{ margin: '1rem' }}>← Back</button>
            <Auth />
          </div>
        )}

        {!showAuth && currentPage === 'home' && (
          <HomePage onNavigate={(page, openMap) => {
            setCurrentPage(page);
            setMapExpanded(openMap ? true : false);
            setMapFullScreen(openMap ? true : false);
          }} />
        )}

        {!showAuth && currentPage === 'saved' && user && (
          <SavedEvents user={user} onUnsave={(eventId) => toggleSaveEvent(eventId)} />
        )}

        {!showAuth && currentPage === 'events' && (
          <div>
            <MapView
              events={filteredEvents}
              selectedEvent={selectedEvent}
              setSelectedEvent={setSelectedEvent}
              mapExpanded={mapExpanded}
              setMapExpanded={setMapExpanded}
              mapFullScreen={mapFullScreen}
              setMapFullScreen={setMapFullScreen}
              getCalendarUrl={getCalendarUrl}
              mapsLoaded={mapsLoaded}
              filterLocation={filterLocation}
              distanceEnabled={distanceEnabled}
              distanceMiles={distanceMiles}
            />
            <div className="filters">
              <button onClick={() => setFilterType('all')} className={filterType === 'all' ? 'active' : ''}>All</button>
              <button onClick={() => setFilterType('meets')} className={filterType === 'meets' ? 'active' : ''}>Meets</button>
              <button onClick={() => setFilterType('auctions')} className={filterType === 'auctions' ? 'active' : ''}>Auctions</button>
              <button onClick={() => setFilterType('races')} className={filterType === 'races' ? 'active' : ''}>Races</button>
              <button onClick={() => setFilterType('autojumbles')} className={filterType === 'autojumbles' ? 'active' : ''}>Autojumbles</button>
              <div className="filter-divider" />
              <button onClick={() => setFilterVehicle('all')} className={filterVehicle === 'all' ? 'active' : ''}>All Vehicles</button>
              <button onClick={() => setFilterVehicle('car')} className={filterVehicle === 'car' ? 'active' : ''}>Cars</button>
              <button onClick={() => setFilterVehicle('motorbike')} className={filterVehicle === 'motorbike' ? 'active' : ''}>Motorbikes</button>
              <button onClick={() => setFilterVehicle('both')} className={filterVehicle === 'both' ? 'active' : ''}>Both</button>
              <div className="filter-divider" />
              <select value={filterMarque} onChange={e => setFilterMarque(e.target.value)} className="marque-select">
                {marques.map(marque => (
                  <option key={marque} value={marque}>{marque === 'all' ? 'All Marques' : marque}</option>
                ))}
              </select>
              <div className="filter-divider" />

              {/* Distance filter */}
              <div className="distance-filter">
                <button
                  className={distanceEnabled ? 'active' : ''}
                  onClick={() => setDistanceEnabled(!distanceEnabled)}
                >
                  📍 Nearby
                </button>
                {distanceEnabled && (
                  <div className="distance-controls">
                    <div className="distance-location-row">
                      <input
                        type="text"
                        className="search-input distance-input"
                        placeholder="My Location"
                        value={locationInput}
                        onChange={e => setLocationInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && geocodeLocation()}
                      />
                      <button className="distance-go-btn" onClick={geocodeLocation}>Go</button>
                      {userLocation && (
                        <button className="distance-gps-btn" onClick={() => {
                          setLocationInput('');
                          setFilterLocation(userLocation);
                          setGeocodeError('');
                        }}>📍 GPS</button>
                      )}
                    </div>
                    {geocodeError && <span className="geocode-error">{geocodeError}</span>}
                    <div className="distance-slider-row">
                      <span className="distance-label">
                        {filterLocation?.label || 'My Location'} · {distanceMiles} mi
                      </span>
                      <input
                        type="range"
                        min="5"
                        max="150"
                        step="5"
                        value={distanceMiles}
                        onChange={e => setDistanceMiles(Number(e.target.value))}
                        className="distance-slider"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="date-filters">
                <input
                  type="date"
                  value={startDate}
                  onChange={e => {
                    setStartDate(e.target.value);
                    setEndDate('');
                    setTimeout(() => document.getElementById('endDate').showPicker(), 100);
                  }}
                />
                <input id="endDate" type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
            <div className="events-list">
              {filteredEvents.length === 0 ? (
                <p>No events found</p>
              ) : (
                filteredEvents.map(event => (
                  <div key={event.id}>
                    <div
                      className={`event-card ${selectedEvent?.id === event.id ? 'selected' : ''}`}
                      onClick={() => {
                        setSelectedEvent(selectedEvent?.id === event.id ? null : event);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      <div className="event-card-header">
                        <h2>{event.title}</h2>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSaveEvent(event.id);
                          }}
                          className={`save-btn ${savedEvents.includes(event.id) ? 'saved' : ''}`}
                        >
                          {savedEvents.includes(event.id) ? '♥' : '♡'}
                        </button>
                      </div>
                      <div className="event-meta">
                        <span>{event.date}</span>
                        <span>{event.start_time}</span>
                        <span>{event.location_name}</span>
                        <span className="event-type">{event.event_type}</span>
                        {event.marque && <span className="event-type">{event.marque}</span>}
                        {event.is_recurring && <span className="event-type recurring">🔄 {event.recurrence}</span>}
                      </div>
                    </div>
                    {selectedEvent?.id === event.id && !mapExpanded && (
                      <div className="event-detail-panel">
                        <div className="sidebar-meta">
                          <p>📅 {event.date}</p>
                          <p>🕐 {event.start_time}</p>
                          <p>📍 {event.location_name}</p>
                          <p>🚗 {event.vehicle_type}</p>
                          {event.marque && <p>🏎 {event.marque}</p>}
                          {event.is_recurring && <p>🔄 {event.recurrence}</p>}
                        </div>
                        {event.description && <p className="sidebar-description">{event.description}</p>}
                        <div className="event-detail-actions">
                          <a href={'https://www.google.com/maps/dir/?api=1&destination=' + event.latitude + ',' + event.longitude} target="_blank" rel="noreferrer" className="sidebar-link directions-btn">🗺 Get Directions</a>
                          <a href={getCalendarUrl(event)} target="_blank" rel="noreferrer" className="sidebar-link calendar-btn">📅 Add to Calendar</a>
                          {event.external_link && <a href={event.external_link} target="_blank" rel="noreferrer" className="sidebar-link">More Info / Tickets</a>}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </LoadScript>
  );
}

export default App;