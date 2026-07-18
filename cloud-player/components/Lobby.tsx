'use client';

import { useState } from 'react';

type Props = {
  onEntered: (info: {
    code: string;
    refereeToken: string | null;
    playerId: string | null;
    playerName: string;
  }) => void;
};

export default function Lobby({ onEntered }: Props) {
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [roomCode, setRoomCode] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [refereePassword, setRefereePassword] = useState('');
  const [asReferee, setAsReferee] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const createRoom = async () => {
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refereePassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '開房失敗');
      onEntered({
        code: data.room.code,
        refereeToken: data.refereeToken,
        playerId: null,
        playerName: '',
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '開房失敗');
    } finally {
      setBusy(false);
    }
  };

  const joinRoom = async () => {
    setError('');
    const code = roomCode.trim().toUpperCase();
    const name = playerName.trim().slice(0, 16);
    if (!code) {
      setError('請輸入房號');
      return;
    }
    if (!name) {
      setError('請輸入你的名字');
      return;
    }

    setBusy(true);
    try {
      let refereeToken: string | null = null;
      if (asReferee) {
        const authRes = await fetch(`/api/rooms/${encodeURIComponent(code)}/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refereePassword }),
        });
        const authData = await authRes.json();
        if (!authRes.ok) throw new Error(authData.error || '裁判密碼錯誤');
        refereeToken = authData.refereeToken;
      }

      const joinRes = await fetch(`/api/rooms/${encodeURIComponent(code)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(refereeToken ? { 'x-referee-token': refereeToken } : {}),
        },
        body: JSON.stringify({
          action: 'player_join',
          session: 'junior',
          name,
        }),
      });
      const joinData = await joinRes.json();
      if (!joinRes.ok) throw new Error(joinData.error || '入房失敗');

      onEntered({
        code,
        refereeToken,
        playerId: joinData.player?.id || null,
        playerName: joinData.player?.name || name,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '入房失敗');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lobby-shell">
      <header className="lobby-hero">
        <span className="player-brand-mark">X</span>
        <h1>咩咩遊樂園</h1>
        <p>開房比賽 · 入房號觀戰／參賽</p>
      </header>

      <div className="lobby-tabs" role="tablist">
        <button
          type="button"
          className={`lobby-tab${mode === 'join' ? ' active' : ''}`}
          onClick={() => setMode('join')}
        >
          入房
        </button>
        <button
          type="button"
          className={`lobby-tab${mode === 'create' ? ' active' : ''}`}
          onClick={() => setMode('create')}
        >
          開房（裁判）
        </button>
      </div>

      {mode === 'join' ? (
        <form
          className="lobby-form"
          onSubmit={(e) => {
            e.preventDefault();
            joinRoom();
          }}
        >
          <label>
            房號
            <input
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="例如 AB12CD"
              autoCapitalize="characters"
              maxLength={8}
              required
            />
          </label>
          <label>
            你的名字
            <input
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="顯示名稱"
              maxLength={16}
              required
            />
          </label>
          <label className="lobby-check">
            <input
              type="checkbox"
              checked={asReferee}
              onChange={(e) => setAsReferee(e.target.checked)}
            />
            我是裁判（輸入裁判密碼）
          </label>
          {asReferee && (
            <label>
              裁判密碼
              <input
                type="password"
                value={refereePassword}
                onChange={(e) => setRefereePassword(e.target.value)}
                placeholder="開房時設定的密碼"
                autoComplete="current-password"
              />
            </label>
          )}
          <button type="submit" className="lobby-submit" disabled={busy}>
            {busy ? '進入中…' : '進入房間'}
          </button>
        </form>
      ) : (
        <form
          className="lobby-form"
          onSubmit={(e) => {
            e.preventDefault();
            createRoom();
          }}
        >
          <p className="lobby-hint">
            開房後進入「對戰計分」即可用完賽按鈕計分；亦可連結本機計分台同步到同一房號。
            請自訂裁判密碼，之後計分要用。
          </p>
          <label>
            裁判密碼
            <input
              type="password"
              value={refereePassword}
              onChange={(e) => setRefereePassword(e.target.value)}
              placeholder="至少 4 個字元"
              minLength={4}
              required
              autoComplete="new-password"
            />
          </label>
          <button type="submit" className="lobby-submit" disabled={busy}>
            {busy ? '開房中…' : '建立房間'}
          </button>
        </form>
      )}

      {error && <p className="lobby-error">{error}</p>}
    </div>
  );
}
