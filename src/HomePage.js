import { useEffect, useState, useRef } from 'react';
import supabase from './supabaseClient';

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function HomePage({ onNavigate, userLocation, events }) {
  const [featured, setFeatured] = useState([]);
  const [recentEvents, setRecentEvents] = useState([]);
  const [news, setNews] = useState([]);
  const [activeCard, setActiveCard] = useState(0);
  const [glowIntensity, setGlowIntensity] = useState(0);
  const [areaName, setAreaName] = useState(() => localStorage.getItem('varoom-area') || '');
  const carouselRef = useRef(null);
  const autoPlayRef = useRef(null);
  const glowTimeoutRef = useRef(null);

  useEffect(() => {
    async function fetchData() {
      const { data: featuredData } = await supabase.from('featured_listings').select('*').eq('is_active', true);
      setFeatured(featuredData || []);
      const { data: eventsData } = await supabase.from('events').select('*').order('created_at', { ascending: false }).limit(5);
      setRecentEvents(eventsData || []);
      const { data: newsData } = await supabase.from('news_posts').select('*').order('created_at', { ascending: false }).limit(3);
      setNews(newsData || []);
    }
    fetchData();
  }, []);

  // Reverse geocode to get area name
  useEffect(() => {
    if (!userLocation || areaName) return;
    const geocoder = new window.google.maps.Geocoder();
    geocoder.geocode({ location: { lat: userLocation.lat, lng: userLocation.lng } }, (results, status) => {
      if (status === 'OK' && results[0]) {
        const county = results[0].address_components.find(c =>
          c.types.includes('administrative_area_level_2')
        );
        const area = county?.long_name || results[0].address_components.find(c =>
          c.types.includes('postal_town')
        )?.long_name || '';
        if (area) {
          setAreaName(area);
          localStorage.setItem('varoom-area', area);
        }
      }
    });
  }, [userLocation, areaName]);

  const nearbyEvents = userLocation
    ? events.filter(e => e.latitude && e.longitude &&
        haversineDistance(userLocation.lat, userLocation.lng, e.latitude, e.longitude) <= 30)
      .sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, 5)
    : [];

  useEffect(() => {
    if (featured.length <= 1) return;
    autoPlayRef.current = setInterval(() => {
      setActiveCard(prev => {
        const next = (prev + 1) % featured.length;
        scrollToCard(next);
        triggerGlow();
        return next;
      });
    }, 5000);
    return () => clearInterval(autoPlayRef.current);
  }, [featured.length]);

  const triggerGlow = () => {
    setGlowIntensity(1);
    clearTimeout(glowTimeoutRef.current);
    glowTimeoutRef.current = setTimeout(() => setGlowIntensity(0), 800);
  };

  const scrollToCard = (index) => {
    if (!carouselRef.current) return;
    const card = carouselRef.current.children[index];
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };

  const handleScroll = () => {
    if (!carouselRef.current) return;
    const newIndex = Math.round(carouselRef.current.scrollLeft / carouselRef.current.offsetWidth);
    if (newIndex !== activeCard) { setActiveCard(newIndex); triggerGlow(); clearInterval(autoPlayRef.current); }
  };

  const goToCard = (index) => {
    setActiveCard(index); scrollToCard(index); triggerGlow(); clearInterval(autoPlayRef.current);
  };

  return (
    <div className="homepage">
      <div className="hero-wrapper" style={{ '--glow-intensity': glowIntensity }}>
        <div className="hero">
          <div className="hero-content">
            <p className="hero-eyebrow">UK Car & Bike Events</p>
            <h2>Find Your Next<br />Event.</h2>
            <p className="hero-sub">Meets, auctions, races and autojumbles — all in one place.</p>
            <div className="hero-buttons">
              <button onClick={() => onNavigate('events')} className="hero-btn primary">Browse Events</button>
              <button onClick={() => onNavigate('events', true)} className="hero-btn secondary">Explore the Map</button>
            </div>
          </div>
        </div>
      </div>

      {featured.length > 0 && (
        <div className="homepage-section featured-section">
          <div className="section-header">
            <h3>Featured</h3>
            <span className="section-line" />
          </div>
          <div className="featured-carousel" ref={carouselRef} onScroll={handleScroll}>
            {featured.map((item, index) => (
              <a key={item.id} href={item.link} target="_blank" rel="noreferrer"
                className={`featured-card carousel-card ${index === activeCard ? 'carousel-card-active' : ''}`}>
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
          {featured.length > 1 && (
            <div className="carousel-dots">
              {featured.map((_, index) => (
                <button key={index} className={`carousel-dot ${index === activeCard ? 'active' : ''}`} onClick={() => goToCard(index)} />
              ))}
            </div>
          )}
        </div>
      )}

      {nearbyEvents.length > 0 && areaName && (
        <div className="homepage-section">
          <div className="section-header">
            <h3>📍 What's On Near {areaName}</h3>
            <span className="section-line" />
          </div>
          <div className="recent-events">
            {nearbyEvents.map(event => (
              <div key={event.id} className="recent-event-card" onClick={() => onNavigate('events')}>
                <div className="recent-event-header">
                  <h4>{event.title}</h4>
                  {event.event_type && <span className="event-type">{event.event_type}</span>}
                </div>
                <div className="event-meta">
                  <span>📅 {event.date}</span>
                  <span>📍 {event.location_name}</span>
                  {event.is_verified && <span className="verified-badge">✓</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recentEvents.length > 0 && (
        <div className="homepage-section">
          <div className="section-header">
            <h3>Recently Added</h3>
            <span className="section-line" />
          </div>
          <div className="recent-events">
            {recentEvents.map(event => (
              <div key={event.id} className="recent-event-card" onClick={() => onNavigate('events')}>
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

      <footer className="site-footer">
        <button onClick={() => onNavigate('events')}>All Events</button>
        <button onClick={() => onNavigate('events', false, 'motorbike')}>🏍 Motorbikes</button>
        <button onClick={() => onNavigate('events', true)}>Explore Map</button>
        <button onClick={() => onNavigate('motorbikes')}>Motorbike Page</button>
      </footer>
    </div>
  );
}

export default HomePage;