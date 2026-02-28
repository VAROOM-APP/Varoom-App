import supabase from './supabaseClient';
import { useEffect, useState } from 'react';

function SavedEvents({ user, onUnsave }) {
  const [savedEventDetails, setSavedEventDetails] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchSaved() {
      const { data: saved } = await supabase
        .from('saved_events')
        .select('event_id')
        .eq('user_id', user.id);

      if (saved && saved.length > 0) {
        const ids = saved.map(s => s.event_id);
        const { data: events } = await supabase
          .from('events')
          .select('*')
          .in('id', ids);
        setSavedEventDetails(events || []);
      }
      setLoading(false);
    }
    fetchSaved();
  }, [user]);

  if (loading) return <p style={{ padding: '24px', color: '#aaaaaa' }}>Loading saved events...</p>;

  if (savedEventDetails.length === 0) {
    return (
      <div style={{ padding: '24px', color: '#aaaaaa' }}>
        <p>You haven't saved any events yet!</p>
        <p>Click the ♡ on any event to save it here.</p>
      </div>
    );
  }

  return (
    <div className="events-list">
      {savedEventDetails.map(event => (
        <div key={event.id} className="event-card">
          <div className="event-card-header">
            <h2>{event.title}</h2>
            <button
              onClick={() => onUnsave(event.id)}
              className="save-btn saved"
            >
              ♥
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
      ))}
    </div>
  );
}

export default SavedEvents;