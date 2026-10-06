import { useEffect, useRef, useState } from 'react'
import { startDeviceTest, takeDeviceSample, finishDeviceTest } from './center'

// one iot test: the device is read every few seconds for about a minute, then the server averages the samples.
// returns the averaged reading (stored in device_readings) for the database to check.
export function useDeviceTest() {
  const [test, setTest] = useState(null)
  const [reading, setReading] = useState(null)
  const [err, setErr] = useState('')
  const [, setTick] = useState(0)
  const cancelled = useRef(false)
  useEffect(() => () => { cancelled.current = true }, [])
  useEffect(() => {
    if (!test) return
    const i = setInterval(() => setTick((n) => n + 1), 250)
    return () => clearInterval(i)
  }, [test])
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  const run = async () => {
    setErr(''); setReading(null)
    cancelled.current = false
    let t
    try { t = await startDeviceTest() } catch (e) { return setErr(e.message) }
    const started = Date.now(), end = started + t.seconds * 1000, samples = []
    let fails = 0
    setTest({ seconds: t.seconds, every: t.every, started, samples: [] })
    while (Date.now() < end) {
      if (cancelled.current) { setTest(null); return }
      const t0 = Date.now()
      try { samples.push(await takeDeviceSample(t.session)); fails = 0 } catch (e) {
        if (++fails >= 3) { setTest(null); return setErr(e.message) }
      }
      setTest({ seconds: t.seconds, every: t.every, started, samples: [...samples] })
      await sleep(Math.max(0, Math.min(t.every * 1000 - (Date.now() - t0), end - Date.now())))
    }
    if (cancelled.current) { setTest(null); return }
    setTest((x) => x && { ...x, finishing: true })
    try { setReading(await finishDeviceTest(t.session)) } catch (e) { setErr(e.message) }
    setTest(null)
  }
  const left = test ? Math.max(0, Math.ceil((test.started + test.seconds * 1000 - Date.now()) / 1000)) : 0
  return { test, reading, err, run, cancel: () => { cancelled.current = true }, left, reset: () => { setReading(null); setErr('') } }
}
