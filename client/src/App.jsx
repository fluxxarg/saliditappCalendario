import { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE = '/api';
const storageKey = (slug) => `currentUser_${slug}`;

function formatDateLabel(dateString) {
  if (!dateString) return '';
  const [y, m, d] = dateString.split('-').map(Number);
  return new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long' }).format(new Date(y, m - 1, d));
}

function getMonthDays(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const days = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

const WEEKDAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function getDefaultDateRange() {
  const today = new Date();
  const start = new Date(today);
  const end = new Date(today.getFullYear(), today.getMonth() + 2, 0);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0]
  };
}

function getRoomDateRange(selection) {
  const today = new Date();
  if (selection === 'next') {
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    const end = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0);
    return {
      startDate: nextMonth.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0]
    };
  }

  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0]
  };
}

function getCalendarMonths(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59`);
  const months = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cursor <= end) {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const weeks = [];
    let week = [];
    const startWeekday = firstDay.getDay();
    for (let i = 0; i < startWeekday; i += 1) {
      const date = new Date(year, month, 1 - (startWeekday - i));
      const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      week.push({ date, dateKey, inRange: false, currentMonth: false });
    }
    for (let day = 1; day <= lastDay.getDate(); day += 1) {
      const date = new Date(year, month, day);
      const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const inRange = date >= start && date <= end;
      week.push({ date, dateKey, inRange, currentMonth: true });
      if (week.length === 7) {
        weeks.push(week);
        week = [];
      }
    }
    if (week.length > 0) {
      for (let i = week.length; i < 7; i += 1) {
        const date = new Date(year, month, lastDay.getDate() + (i - week.length + 1));
        const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        week.push({ date, dateKey, inRange: false, currentMonth: false });
      }
      weeks.push(week);
    }
    months.push({
      year,
      month,
      label: new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric' }).format(firstDay),
      weeks
    });
    cursor.setMonth(cursor.getMonth() + 1);
    cursor.setDate(1);
  }
  return months;
}

function App() {
  const [slug, setSlug] = useState('');
  const [room, setRoom] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [users, setUsers] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [currentUserId, setCurrentUserId] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [roomName, setRoomName] = useState('');
  const [selectedRoomMonth, setSelectedRoomMonth] = useState('current');
  const newRoomRange = useMemo(() => getRoomDateRange(selectedRoomMonth), [selectedRoomMonth]);
  const [message, setMessage] = useState('');
  const [showDisclaimer, setShowDisclaimer] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState({});
  const [dragging, setDragging] = useState(false);
  const [dragAction, setDragAction] = useState('add');
  const [pendingDates, setPendingDates] = useState(new Set());
  const [expandedBestDay, setExpandedBestDay] = useState(null);
  const availabilityRef = useRef([]);

  useEffect(() => {
    const path = window.location.pathname.replace(/^\//, '') || '';
    setSlug(path || '');
    loadRooms();
    if (path) {
      loadRoom(path);
    } else {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    availabilityRef.current = availability;
  }, [availability]);

  useEffect(() => {
    if (!dragging) return;
    const stopDragging = () => setDragging(false);
    window.addEventListener('pointerup', stopDragging);
    return () => window.removeEventListener('pointerup', stopDragging);
  }, [dragging]);

  const addPendingDate = (dateKey) => setPendingDates((prev) => new Set(prev).add(dateKey));
  const removePendingDate = (dateKey) => setPendingDates((prev) => {
    const next = new Set(prev);
    next.delete(dateKey);
    return next;
  });

  const loadRooms = async () => {
    try {
      const res = await fetch(`${API_BASE}/rooms`);
      if (!res.ok) return;
      const data = await res.json();
      setRooms(data);
    } catch {
      setRooms([]);
    }
  };

  const loadRoom = async (roomSlug) => {
    setLoading(true);
    try {
      const roomRes = await fetch(`${API_BASE}/rooms/${roomSlug}`);
      if (!roomRes.ok) {
        setRoom(null);
        setLoading(false);
        return;
      }
      const roomData = await roomRes.json();
      setRoom(roomData);
      const usersRes = await fetch(`${API_BASE}/rooms/${roomSlug}/users`);
      const usersData = await usersRes.json();
      setUsers(usersData);
      const availabilityRes = await fetch(`${API_BASE}/rooms/${roomSlug}/availability`);
      const availabilityData = await availabilityRes.json();
      setAvailability(availabilityData);
      const savedUserId = localStorage.getItem(storageKey(roomSlug));
      if (savedUserId) {
        setCurrentUserId(savedUserId);
      } else if (usersData[0]) {
        setCurrentUserId(usersData[0].id);
      }
    } catch (err) {
      setError('No se pudo cargar la sala');
    } finally {
      setLoading(false);
    }
  };

  const createRoom = async (e) => {
    e.preventDefault();
    if (!roomName.trim()) {
      setError('Ingresá un nombre para la sala');
      return;
    }

    setCreatingRoom(true);
    setError('');
    setMessage('Creando sala…');
    try {
      const res = await fetch(`${API_BASE}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: roomName.trim(), startDate: newRoomRange.startDate, endDate: newRoomRange.endDate })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo crear la sala');
      window.history.pushState({}, '', `/${data.slug}`);
      setSlug(data.slug);
      setRoom(data);
      setRooms((prev) => [data, ...prev]);
      setUsers([]);
      setAvailability([]);
      setCurrentUserId('');
      setMessage(`Sala creada: ${data.name}`);
      setLoading(false);
      await loadRoom(data.slug);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreatingRoom(false);
    }
  };

  useEffect(() => {
    if (currentUserId && slug) {
      localStorage.setItem(storageKey(slug), currentUserId);
    }
  }, [currentUserId, slug]);

  const goBack = async () => {
    window.history.pushState({}, '', '/');
    setSlug('');
    setRoom(null);
    setLoading(true);
    await loadRooms();
    setLoading(false);
  };

  const reloadRoom = async () => {
    if (!slug) return;
    setLoading(true);
    await loadRoom(slug);
  };

  const createUser = async (e) => {
    e.preventDefault();
    if (!slug || !newUserName.trim()) return;
    try {
      const res = await fetch(`${API_BASE}/rooms/${slug}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newUserName.trim() })
      });
      const created = await res.json();
      if (!res.ok) throw new Error(created.error || 'No se pudo crear el usuario');
      setUsers((prev) => [...prev, created]);
      setCurrentUserId(created.id);
      setNewUserName('');
      setMessage(`Usuario ${created.name} creado`);
    } catch (err) {
      setError(err.message);
    }
  };

  const toggleAvailability = async (dateString, userId, mode = null) => {
    if (!slug || !userId) return;
    const exists = availabilityRef.current.some((item) => item.date === dateString && item.userId === userId);
    const shouldAdd = mode === null ? !exists : mode === 'add';
    const previousAvailability = availabilityRef.current;
    const placeholderId = `pending-${dateString}-${userId}`;

    addPendingDate(dateString);
    if (shouldAdd) {
      setAvailability((prev) => [...prev, { userId, date: dateString, note: notes[userId] || '', id: placeholderId }]);
    } else {
      setAvailability((prev) => prev.filter((item) => !(item.date === dateString && item.userId === userId)));
    }

    try {
      if (shouldAdd) {
        const res = await fetch(`${API_BASE}/rooms/${slug}/availability`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, date: dateString, note: notes[userId] || '' })
        });
        const created = await res.json();
        if (!res.ok) throw new Error(created.error || 'No se pudo guardar la disponibilidad');
        setAvailability((prev) => prev.map((item) => (item.id === placeholderId ? created : item)));
      } else {
        const res = await fetch(`${API_BASE}/rooms/${slug}/availability?userId=${userId}&date=${dateString}`, { method: 'DELETE' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'No se pudo quitar la disponibilidad');
      }
      setMessage(shouldAdd ? 'Fecha marcada' : 'Fecha quitada');
    } catch (err) {
      setError(err.message || 'No se pudo guardar la disponibilidad');
      setAvailability(previousAvailability);
    } finally {
      removePendingDate(dateString);
    }
  };

  const handleDayPointerDown = (dateString, userId) => {
    if (!slug || !userId) return;
    const exists = availabilityRef.current.some((item) => item.date === dateString && item.userId === userId);
    setDragging(true);
    setDragAction(exists ? 'remove' : 'add');
    void toggleAvailability(dateString, userId, exists ? 'remove' : 'add');
  };

  const handleDayPointerEnter = (dateString, userId) => {
    if (!dragging || !slug || !userId) return;
    const exists = availabilityRef.current.some((item) => item.date === dateString && item.userId === userId);
    const shouldAdd = dragAction === 'add';
    if ((shouldAdd && !exists) || (!shouldAdd && exists)) {
      void toggleAvailability(dateString, userId, shouldAdd ? 'add' : 'remove');
    }
  };

  const confirmDate = async (dateString) => {
    if (!slug) return;
    const nextValue = room?.confirmedDate === dateString ? null : dateString;
    try {
      const res = await fetch(`${API_BASE}/rooms/${slug}/confirm`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date: nextValue })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'No se pudo confirmar');
      setRoom(data);
      setMessage(nextValue ? 'Fecha confirmada' : 'Confirmación removida');
    } catch (err) {
      setError(err.message);
    }
  };

  const dayEntries = useMemo(() => {
    if (!room) return [];
    const entries = new Map();
    availability.forEach((item) => {
      if (!entries.has(item.date)) entries.set(item.date, []);
      entries.get(item.date).push(item);
    });
    return entries;
  }, [availability, room]);

  const calendarMonths = useMemo(() => {
    if (!room) return [];
    return getCalendarMonths(room.startDate, room.endDate);
  }, [room]);

  const bestDays = useMemo(() => {
    if (!room) return [];
    const allDays = calendarMonths.flatMap((month) =>
      month.weeks.flatMap((week) => week.filter(Boolean).map((cell) => cell.date))
    );
    const scores = allDays
      .map((day) => {
        const dateKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
        const usersForDay = dayEntries.get(dateKey) || [];
        return { date: dateKey, count: usersForDay.length };
      })
      .filter((item) => item.count > 1);
    const maxCount = Math.max(...scores.map((item) => item.count), 0);
    return scores.filter((item) => item.count === maxCount).map((item) => item.date);
  }, [calendarMonths, dayEntries, room]);

  const bestDayDetails = useMemo(() => {
    if (!bestDays.length) return [];
    return bestDays.map((dateKey) => ({
      date: dateKey,
      users: (dayEntries.get(dateKey) || [])
        .map((item) => users.find((user) => user.id === item.userId))
        .filter(Boolean)
    }));
  }, [bestDays, dayEntries, users]);

  if (loading) {
    return (
      <div className="app-shell">
        <button className="info-float-button" type="button" onClick={() => setShowDisclaimer(true)} aria-label="Información">!</button>
        <div className="brand-header">
          <img src="/assets/saliditappLogo.png" alt="Saliditapp" className="brand-logo" />
        </div>
        <div className="card">Cargando salas…</div>
        {showDisclaimer && (
          <div className="disclaimer-overlay" onClick={() => setShowDisclaimer(false)}>
            <div className="disclaimer-modal" onClick={(e) => e.stopPropagation()}>
              <button className="close-button" type="button" onClick={() => setShowDisclaimer(false)} aria-label="Cerrar">×</button>
              <h3>Uso gratuito</h3>
              <p>Esta app es de uso gratuito con todos los logos de uso libre.</p>
              <p>Reconocimiento especial al autor: Emiliano Luna.</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!slug) {
    return (
      <div className="app-shell">
        <button className="info-float-button" type="button" onClick={() => setShowDisclaimer(true)} aria-label="Información">!</button>
        <div className="brand-header">
          <div className="brand-icon-container">
            <img src="/assets/saliditappLogo.png" alt="Saliditapp" className="brand-logo" />
          </div>
        </div>
        <h1 className="page-title">Saliditapp-Calendario</h1>
        <p className="page-description">Elegí una sala o creá una nueva para empezar.</p>
        <form onSubmit={createRoom} className="card">
          <div className="form-row">
            <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Nombre de la sala" />
            <button type="submit" disabled={creatingRoom}>{creatingRoom ? 'Creando…' : 'Crear sala'}</button>
          </div>
          <div className="form-row month-selection-row">
            <label>
              <input type="radio" name="roomMonth" value="current" checked={selectedRoomMonth === 'current'} onChange={() => setSelectedRoomMonth('current')} />
              Mes actual
            </label>
            <label>
              <input type="radio" name="roomMonth" value="next" checked={selectedRoomMonth === 'next'} onChange={() => setSelectedRoomMonth('next')} />
              Mes próximo
            </label>
          </div>
          <div className="range-label">Rango permitido: {newRoomRange.startDate} — {newRoomRange.endDate}</div>
        </form>
        <section className="card">
          <h3>Salas disponibles</h3>
          <div className="room-list">
            {rooms.map((item) => (
              <button key={item.id || item.slug} className="room-card" onClick={() => { window.history.pushState({}, '', `/${item.slug}`); setSlug(item.slug); setRoom(item); setLoading(true); loadRoom(item.slug); }}>
                <strong>{item.name}</strong>
                <span>{item.startDate} → {item.endDate}</span>
              </button>
            ))}
          </div>
        </section>
        <footer className="footer footer-panel">
          <div className="footer-inner">
            <div className="footer-brand-row">
              <div className="footer-icon-circle">
                <img src="/assets/logocircle-CxSLZn0d.png" alt="Fluxxar Software Studio" className="footer-logo" />
              </div>
              <p className="footer-brand-text">© 2026 Fluxxar Software Studio™</p>
            </div>
            <p className="footer-note">Todos los derechos reservados.</p>
            <p className="footer-note">Desarrollado por Emiliano Luna.</p>
          </div>
        </footer>
        {showDisclaimer && (
          <div className="disclaimer-overlay" onClick={() => setShowDisclaimer(false)}>
            <div className="disclaimer-modal" onClick={(e) => e.stopPropagation()}>
              <button className="close-button" type="button" onClick={() => setShowDisclaimer(false)} aria-label="Cerrar">×</button>
              <h3>Uso gratuito</h3>
              <p>Esta app es de uso gratuito con todos los logos de uso libre.</p>
              <p>Reconocimiento especial al autor: Emiliano Luna.</p>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!room) {
    return (
      <div className="app-shell">
        <div className="brand-header">
          <div className="brand-icon-container">
            <img src="/assets/saliditappLogo.png" alt="Saliditapp" className="brand-logo" />
          </div>
        </div>
        <h1 className="page-title">Saliditapp-Calendario</h1>
        <p className="page-description">La sala que buscás todavía no existe. Creá una para empezar.</p>
        <form onSubmit={createRoom} className="card">
          <div className="form-row">
            <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Nombre de la sala" />
            <button type="submit" disabled={creatingRoom}>{creatingRoom ? 'Creando…' : 'Crear sala'}</button>
          </div>
          <div className="range-label">Rango inicial: {newRoomRange.startDate} — {newRoomRange.endDate}</div>
        </form>
        <footer className="footer footer-panel">
          <div className="footer-inner">
            <div className="footer-brand-row">
              <div className="footer-icon-circle">
                <img src="/assets/logocircle-CxSLZn0d.png" alt="Fluxxar Software Studio" className="footer-logo" />
              </div>
              <p className="footer-brand-text">© 2026 Fluxxar Software Studio™</p>
            </div>
            <p className="footer-note">Todos los derechos reservados.</p>
            <p className="footer-note">Desarrollado por Emiliano Luna.</p>
          </div>
        </footer>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="brand-header">
        <div className="brand-icon-container">
          <img src="/assets/saliditappLogo.png" alt="Saliditapp" className="brand-logo" />
        </div>
      </div>
      <header className="topbar">
        <div className="topbar-center">
          <h1>Saliditapp-Calendario</h1>
          {room?.name && <div className="room-subtitle">{room.name}</div>}
        </div>
        <div className="topbar-actions">
          <button type="button" className="black-button" onClick={goBack}>← Atrás</button>
          <button type="button" className="black-button" onClick={reloadRoom}>Recargar</button>
        </div>
      </header>

      {message && <div className="message success">{message}</div>}
      {error && <div className="message error">{error}</div>}

      <section className="card user-panel">
        <div className="user-panel-form">
          <h3>Agregar usuario</h3>
          <form onSubmit={createUser} className="user-form">
            <input value={newUserName} onChange={(e) => setNewUserName(e.target.value)} placeholder="Nombre" />
            <button type="submit">Crear usuario</button>
          </form>
        </div>
        <div className="user-panel-list">
          <h3>Usuarios</h3>
          <div className="users-list">
            {users.map((user) => (
              <button key={user.id} className={`user-chip ${currentUserId === user.id ? 'active' : ''}`} onClick={() => setCurrentUserId(user.id)}>
                <span className="dot" style={{ backgroundColor: user.color }} />
                {user.name}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="calendar-toolbar">
          <div>
            <h3>Elegí tus fechas</h3>
            <p>Presioná sobre un día para marcar o quitar tu disponibilidad.</p>
          </div>
        </div>
        {bestDays.length > 0 ? (
          <div className="festive-banner">
            <div className="festive-banner__top">
              <div className="festive-banner__icon">🎉</div>
              <div className="festive-banner__content">
                {room?.confirmedDate ? (
                  <>
                    <div className="banner-title">Fecha confirmada</div>
                    <div className="banner-date">{formatDateLabel(room.confirmedDate)}</div>
                  </>
                ) : (
                  <>
                    <div className="banner-date">{bestDays.map((day) => formatDateLabel(day)).join(' y ')}</div>
                    <div className="banner-title">mejor día sugerido</div>
                  </>
                )}
              </div>
            </div>
            <div className="festive-banner__actions">
              {bestDayDetails.map((detail) => {
                const isOpen = expandedBestDay === detail.date;
                return (
                  <div key={detail.date} className="best-day-item">
                    <button
                      type="button"
                      className="best-day-toggle"
                      onClick={() => setExpandedBestDay(isOpen ? null : detail.date)}
                    >
                      <span>{formatDateLabel(detail.date)}</span>
                      <span>{isOpen ? '▲' : '▼'}</span>
                    </button>
                    {isOpen && (
                      <ul className="participant-list">
                        {detail.users.length > 0 ? (
                          detail.users.map((user) => (
                            <li key={user.id} className="participant-chip">
                              <span className="dot" style={{ backgroundColor: user.color }} />
                              {user.name}
                            </li>
                          ))
                        ) : (
                          <li className="participant-chip participant-chip--empty">Aún no hay participantes para este día.</li>
                        )}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="subtle-banner">Continúa marcando tus días para que el mejor día se destaque.</div>
        )}
        <div className="calendar-grid">
          {calendarMonths.map((month) => (
            <div className="calendar-month" key={`${month.year}-${month.month}`}>
              <div className="month-title">{month.label}</div>
              <div className="weekday-row">
                {WEEKDAY_LABELS.map((label) => (
                  <div key={label} className="weekday-cell">{label}</div>
                ))}
              </div>
              {month.weeks.map((week, weekIndex) => (
                <div className="week-row" key={weekIndex}>
                  {week.map((cell, cellIndex) => {
                    if (!cell) {
                      return <div key={cellIndex} className="day-cell blank" />;
                    }
                    const usersForDay = (dayEntries.get(cell.dateKey) || []).map((item) => users.find((user) => user.id === item.userId)).filter(Boolean);
                    const isConfirmed = room?.confirmedDate === cell.dateKey;
                    const selected = usersForDay.some((user) => user?.id === currentUserId);
                    const isPending = pendingDates.has(cell.dateKey);
                    return (
                      <button
                        key={cellIndex}
                        disabled={!cell.inRange || !currentUserId}
                        className={`day-cell ${selected ? 'selected' : ''} ${isConfirmed ? 'confirmed' : ''} ${!cell.inRange ? 'disabled' : ''} ${cell.currentMonth === false ? 'other-month' : ''} ${isPending ? 'pending' : ''}`}
                        onPointerDown={() => cell.inRange && handleDayPointerDown(cell.dateKey, currentUserId)}
                        onPointerEnter={() => cell.inRange && handleDayPointerEnter(cell.dateKey, currentUserId)}
                        onPointerUp={() => setDragging(false)}
                      >
                        <span className="day-number">{cell.date.getDate()}</span>
                        <div className="day-meta">
                          {usersForDay.length > 0 ? `${usersForDay.length}/${users.length}` : cell.inRange ? '—' : ''}
                        </div>
                        {!cell.inRange && <span className="day-x">×</span>}
                        {usersForDay.length > 0 && usersForDay.length === 1 && (
                          <div className="single-color" style={{ backgroundColor: usersForDay[0].color }} />
                        )}
                        {usersForDay.length > 1 && (
                          <div className="multi-color" style={{ background: 'linear-gradient(135deg, #d9f99d 0%, #22c55e 100%)' }} />
                        )}
                        {isPending && <span className="day-pending">Guardando…</span>}
                        {isConfirmed && <span className="check">✓</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>

      <footer className="footer footer-panel">
        <div className="footer-inner">
          <div className="footer-brand-row">
            <div className="footer-icon-circle">
              <img src="/assets/logocircle-CxSLZn0d.png" alt="Fluxxar Software Studio" className="footer-logo" />
            </div>
            <p className="footer-brand-text">© 2026 Fluxxar Software Studio™</p>
          </div>
          <p className="footer-note">Todos los derechos reservados.</p>
          <p className="footer-note">Desarrollado por Emiliano Luna.</p>
        </div>
      </footer>
    </div>
  );
}

export default App;
