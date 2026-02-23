import { useEffect, useState } from 'react';
import supabase from './supabaseClient';
import './App.css';
import MapView from './MapView';

function App() {
  const [events, setEvents] = useState([]);
  const [filterType, setFilterType] = useState('all');
  const [filterVehicle, setFilterVehicle] = useState('all');
  const [startDate, setStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    async function getEvents() {
      const { data } = await supabase.from('events').select('*');
      setEvents(data || []);
    }
    getEvents();
  }, []);

  const filteredEvents = events.filter(event => {
    const matchesType = filterType === 'all' || event.event_type === filterType;
    const matchesVehicle = filterVehicle === 'all' || event.vehicle_type === filterVehicle;
    const matchesStart = !startDate || event.date >= startDate;
    const matchesEnd = !endDate || event.date <= endDate;
    return matchesType && matchesVehicle && matchesStart && matchesEnd;
  });

  return (
    <div>
      <div className="header">
        <h1>Varoom</h1>
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
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default App;