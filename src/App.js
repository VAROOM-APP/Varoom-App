import { useEffect, useState } from 'react';
import supabase from './supabaseClient';
import './App.css';
import MapView from './MapView';
import Auth from './Auth';

function App() {
  const [events, setEvents] = useState([]);
  const [filterType, setFilterType] = useState('all');
  const [filterVehicle, setFilterVehicle] = useState('all');
  const [filterMarque, setFilterMarque] = useState('all');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState('');
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setShowAuth(false);
    });

    async function getEvents() {
      const { data } = await supabase.from('events').select('*');
      setEvents(data || []);
    }
    getEvents();
  }, []);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const marques = ['all', ...new Set(events
    .filter(e => e.marque)
    .map(e => e.marque))];

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
        <h1>Varoom</h1>
        <div className="header-right">
          {user ? (
            <>
              <span className="header-email">{user.email}</span>
              <button onClick={handleSignOut} className="header-btn">Sign Out</button>
            </>
          ) : (
            <button onClick={() => setShowAuth(true)} className="header-btn">Sign In</button>
          )}
        </div>
      </div>
      <MapView events={filteredEvents} />
      <div className="filters">
        <button onClick={() => setFilterType('all')} className={filterType === 'all' ? 'active' : ''}>All</button>
        <button onClick={() => setFilterType('meet')} className={filterType === 'meet' ? 'active' : ''}>Meets</button>
        <button onClick={() => setFilterType('auction')} className={filterType === 'auction' ? 'active' : ''}>Auctions</button>
        <button onClick={() => setFilterType('race')} className={filterType === 'race' ? 'active' : ''}>Races</button>
        <button onClick={() => setFilterType('autojumble')} className={filterType === 'autojumble' ? 'active' : ''}>Autojumbles</button>
        <div className="filter-divider" />
        <button onClick={() => setFilterVehicle('all')} className={filterVehicle === 'all' ? 'active' : ''}>All Vehicles</button>
        <button onClick={() => setFilterVehicle('car')} className={filterVehicle === 'car' ? 'active' : ''}>Cars</button>
        <button onClick={() => setFilterVehicle('motorbike')} className={filterVehicle === 'motorbike' ? 'active' : ''}>Motorbikes</button>
        <button onClick={() => setFilterVehicle('both')} className={filterVehicle === 'both' ? 'active' : ''}>Both</button>
        <div className="filter-divider" />
        <select
          value={filterMarque}
          onChange={e => setFilterMarque(e.target.value)}
          className="marque-select"
        >
          {marques.map(marque => (
            <option key={marque} value={marque}>
              {marque === 'all' ? 'All Marques' : marque}
            </option>
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
          <input
            id="endDate"
            type="date"
            value={endDate}
            min={startDate}
            onChange={e => setEndDate(e.target.value)}
          />
        </div>
      </div>
      <div className="events-list">
        {filteredEvents.length === 0 ? (
          <p>No events found</p>
        ) : (
          filteredEvents.map(event => (
            <div key={event.id} className="event-card">
              <h2>{event.title}</h2>
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
  );
}

export default App;
