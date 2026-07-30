/**
 * store เล็กๆ ไม่ต้องพึ่ง library ภายนอก
 *
 * ใช้กับ React ได้ผ่าน useStore (useSyncExternalStore)
 * และเรียกจากที่ไหนก็ได้ผ่าน getState / subscribe (ไม่ผูกกับ React)
 */

import { useSyncExternalStore } from 'react'

export interface Store<State extends object> {
  getState: () => State
  setState: (patch: Partial<State> | ((current: State) => Partial<State>)) => void
  /** คืนค่า state เป็นค่าเริ่มต้น */
  reset: () => void
  subscribe: (listener: () => void) => () => void
}

export const createStore = <State extends object>(initialState: State): Store<State> => {
  let state = initialState
  const listeners = new Set<() => void>()

  const notify = (): void => {
    listeners.forEach((listener) => listener())
  }

  return {
    getState: () => state,

    setState: (patch) => {
      const next = typeof patch === 'function' ? patch(state) : patch
      let changed = false
      for (const key of Object.keys(next) as Array<keyof State>) {
        if (!Object.is(state[key], next[key])) {
          changed = true
          break
        }
      }
      if (!changed) return // ไม่มีอะไรเปลี่ยน ไม่ต้อง re-render
      state = { ...state, ...next }
      notify()
    },

    reset: () => {
      state = initialState
      notify()
    },

    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** hook สำหรับ React — คืน state ทั้งก้อน (อ้างอิงเดิมถ้าไม่มีอะไรเปลี่ยน) */
export const useStore = <State extends object>(store: Store<State>): State =>
  useSyncExternalStore(store.subscribe, store.getState, store.getState)

/** สถานะร่วมที่ทุก store ใช้ */
export interface AsyncState {
  loading: boolean
  /** ข้อความ error ล่าสุด ('' = ไม่มี) */
  error: string
  /** เวลาที่โหลดสำเร็จครั้งล่าสุด (ISO) */
  loadedAt: string | null
}

export const initialAsyncState: AsyncState = { loading: false, error: '', loadedAt: null }

/** ครอบการเรียก API ให้จัดการ loading/error ให้เอง */
export const withAsync = async <State extends AsyncState, Result>(
  store: Store<State>,
  run: () => Promise<Result>,
): Promise<Result> => {
  store.setState({ loading: true, error: '' } as Partial<State>)
  try {
    const result = await run()
    store.setState({ loading: false, loadedAt: new Date().toISOString() } as Partial<State>)
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    store.setState({ loading: false, error: message } as Partial<State>)
    throw error
  }
}
