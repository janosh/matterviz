// Time units whose inverse is expressible in THz. A dt in anything else can still drive
// the lag axis, but asking for a THz / cm^-1 VDOS on top of it throws.
export const TIME_UNIT_TO_THZ: Record<string, number> = { fs: 1000, ps: 1, ns: 0.001 }

export const thz_per_inverse_time = (time_unit: string): number | undefined =>
  Object.hasOwn(TIME_UNIT_TO_THZ, time_unit) ? TIME_UNIT_TO_THZ[time_unit] : undefined
