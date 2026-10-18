import { useEffect, useState } from 'react';
import supabase from './supabaseClient';

function HomePage({ onNavigate }) {
  const [featured, setFeatured] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);
  const [news, setNews] = useState([]);

  useEffect(() => {
    async function fetchData() {
      const { data: featuredData } = await supabase
        .from('featured_listings')
        .select('*')
        .eq('is_active', true);
      setFeatured(featuredData || []);

      const { data: eventsData } = await supabase
        .from('events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);
      setRecentEvents(eventsData || []);

      const { data: newsData } = await supabase
        .from('news_posts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(3);
      setNews(newsData || []);
    }
    fetchData();
  }, []);

  return (
    <div className="homepage">

      {/* Hero */}
      <div className="hero">
        <div className="hero-content">
          <p className="hero-eyebrow">UK Car & Bike Events</p>
          <h2>Find Your Next<br />Event.</h2>
          <p className="hero-sub">Meets, auctions, races and autojumbles — all in one place.</p>
          <div className="hero-buttons">
            <button onClick={() => onNavigate('events')} className="hero-btn primary">Browse Events</button>
            <button onClick={() => onNavigate('events', true)} className="hero-btn secondary">Map View</button>
          </div>
        </div>
      </div>

      {/* Featured */}
      {featured.length > 0 && (
        <div className="homepage-section">
          <div className="section-header">
            <h3>Featured</h3>
            <span className="section-line" />
          </div>
          <div className="featured-grid">
            {featured.map(item => (
              <a key={item.id} href={item.link} target="_blank" rel="noreferrer" className="featured-card">
                {item.image_url ? (
                  <img src={item.image_url} alt={item.title} className="featured-image" />
                ) : (
                  <div className="featured-placeholder">🔨</div>
                )}
                <div className="featured-content">
                  <span className="featured-tag">{item.type}</span>
                  <h4>{item.title}</h4>
                  <p>{item.description}</p>
                  <span className="featured-link">Find out more →</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Recent Events */}
      {recentEvents.length > 0 && (
        <div className="homepage-section">
          <div className="section-header">
            <h3>Recently Added</h3>
            <span className="section-line" />
          </div>
          <div className="recent-events">
            {recentEvents.map(event => (
              <div key={event.id} className="recent-event-card stitch-card" onClick={() => onNavigate('events')}>
                <div className="recent-event-header">
                  <h4>{event.title}</h4>
                  {event.event_type && <span className="event-type">{event.event_type}</span>}
                </div>
                <div className="event-meta">
                  <span>📅 {event.date}</span>
                  <span>📍 {event.location_name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* News */}
      {news.length > 0 && (
        <div className="homepage-section">
          <div className="section-header">
            <h3>Latest News</h3>
            <span className="section-line" />
          </div>
          <div className="news-grid">
            {news.map(post => (
              <div key={post.id} className="news-card">
                {post.image_url && <img src={post.image_url} alt={post.title} className="news-image" />}
                <div className="news-content">
                  <h4>{post.title}</h4>
                  <p>{post.content}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

export default HomePage;