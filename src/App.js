import { useEffect, useState } from 'react';
import supabase from './supabaseClient';
import './App.css';
import MapView from './MapView';
import Auth from './Auth';
import SavedEvents from './SavedEvents';
import HomePage from './HomePage';

function App() {
  const [events, setEvents] = useState([]);
  const [filterType, setFilterType] = useState('all');
  const [filterVehicle, setFilterVehicle] = useState('all');
  const [filterMarque, setFilterMarque] = useState('all');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState('');
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [savedEvents, setSavedEvents] = useState([]);
  const [currentPage, setCurrentPage] = useState('home');
  const [selectedEvent, setSelectedEvent] = useState(null);

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

  const marques = ['all', ...new Set(events.filter(e => e.marque).map(e => e.marque))];

  const filteredEvents = events.filter(event => {
    const matchesType = filterType === 'all' || event.event_type === filterType;
    const matchesVehicle = filterVehicle === 'all' || event.vehicle_type === filterVehicle;
    const matchesMarque = filterMarque === 'all' || event.marque === filterMarque;
    const matchesStart = !startDate || event.date >= startDate;
    const matchesEnd = !endDate || event.date <= endDate;
    return matchesType && matchesVehicle && matchesMarque && matchesStart && matchesEnd;
  });

  if (showAuth) {
    return (
      <div>
        <div className="header">
          <h1 onClick={() => setShowAuth(false)} style={{ cursor: 'pointer' }}>Varoom</h1>
          <button onClick={() => setShowAuth(false)} className="header-btn">Back</button>
        </div>
        <Auth />
      </div>
    );
  }

  return (
    <div>
      <div className="header">
        <h1 onClick={() => setCurrentPage('home')} style={{ cursor: 'pointer' }}>Varoom</h1>
        <div className="header-right">
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

      {currentPage === 'home' && (
        <HomePage onNavigate={(page) => setCurrentPage(page)} />
      )}

      {currentPage === 'saved' && user && (
        <SavedEvents user={user} onUnsave={(eventId) => toggleSaveEvent(eventId)} />
      )}

      <div style={{ display: currentPage === 'events' ? 'block' : 'none' }}>
        <MapView
          events={filteredEvents}
          selectedEvent={selectedEvent}
          setSelectedEvent={setSelectedEvent}
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
              <div
                key={event.id}
                className={`event-card ${selectedEvent?.id === event.id ? 'selected' : ''}`}
                onClick={() => {
                  setSelectedEvent(event);
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
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default App;