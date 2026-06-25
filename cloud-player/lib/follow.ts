'use client';

import { useEffect, useRef } from 'react';
import { SessionData } from '@/lib/constants';
import { getAllMatches, matchInvolvesName, playerName, sortMatches } from '@/lib/tournament';

const FOLLOW_KEY = 'bex-cloud-follow';

export function useFollowPlayer(search: string, sessionData: SessionData | null) {
  const lastNotifiedRef = useRef<string | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const follow = params.get('follow');
    if (follow) {
      localStorage.setItem(FOLLOW_KEY, follow);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !sessionData?.drawn) return;
    const follow = search || localStorage.getItem(FOLLOW_KEY) || '';
    if (!follow) return;

    const next = sortMatches(
      getAllMatches(sessionData).filter((m) => m.status === 'pending' && m.p1Id && m.p2Id),
    ).find((m) => matchInvolvesName(m, sessionData, follow));

    if (!next || next.id === lastNotifiedRef.current) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;

    const body = `${next.label || ''} 即將開始`.trim();
    new Notification('下一場對戰', {
      body: `${playerName(sessionData, next.p1Id)} vs ${playerName(sessionData, next.p2Id)}${body ? ` · ${body}` : ''}`,
      tag: `next-${next.id}`,
    });
    lastNotifiedRef.current = next.id;
  }, [sessionData, search]);
}

export function saveFollowName(name: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(FOLLOW_KEY, name);
}

export function getSavedFollowName() {
  if (typeof window === 'undefined') return '';
  return localStorage.getItem(FOLLOW_KEY) || '';
}

export function requestNotifyPermission() {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
  Notification.requestPermission();
}
