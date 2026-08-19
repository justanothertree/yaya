import { useSyncExternalStore } from 'react'
import { voiceSession } from './voiceSession'

/**
 * React's view of the call. Deliberately thin: the session itself lives in voiceSession so
 * it survives every unmount, and this only reads it. Any component can call this — the chat
 * thread, and the app-wide call bar that lets you mute or hang up from any page.
 */
export function useVoiceSession() {
  const state = useSyncExternalStore(
    voiceSession.subscribe,
    voiceSession.getState,
    voiceSession.getState,
  )
  return {
    ...state,
    join: voiceSession.join,
    leave: voiceSession.leave,
    toggleMute: voiceSession.toggleMute,
    setThreshold: voiceSession.setThreshold,
    setPeerVolume: voiceSession.setPeerVolume,
    setMaster: voiceSession.setMaster,
    // not part of the snapshot on purpose — see voiceSession.getMicLevel
    getMicLevel: voiceSession.getMicLevel,
    isOpen: voiceSession.isOpen,
    usesWebAudio: voiceSession.usesWebAudio,
    startShare: voiceSession.startShare,
    stopShare: voiceSession.stopShare,
    getLocalShare: voiceSession.getLocalShare,
    setShareMode: voiceSession.setShareMode,
    warmIce: voiceSession.warmIce,
    hasTurn: voiceSession.hasTurn,
    debugSnapshot: voiceSession.debugSnapshot,
  }
}
