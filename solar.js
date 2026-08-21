/**
 * solar.js — Local astronomical solar position calculations.
 *
 * All algorithms are based on the NOAA Solar Calculator (Jean Meeus,
 * "Astronomical Algorithms") and run entirely offline — no network
 * requests are made.
 *
 * Reference: https://gml.noaa.gov/grad/solcalc/solareqns.PDF
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

const DEG = Math.PI / 180;   // degrees → radians
const RAD = 180 / Math.PI;   // radians → degrees

/* ------------------------------------------------------------------ */
/*  Fundamental astronomical quantities                                */
/* ------------------------------------------------------------------ */

/**
 * Convert a Gregorian calendar date to Julian Day Number.
 * Valid for dates after 15 October 1582 (Gregorian reform).
 */
export function julianDay(year, month, day) {
    if (month <= 2) {
        year  -= 1;
        month += 12;
    }
    const A = Math.floor(year / 100);
    const B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (year + 4716))
         + Math.floor(30.6001 * (month + 1))
         + day + B - 1524.5;
}

/** Julian Century (36 525 days) from J2000.0 epoch. */
export function julianCentury(jd) {
    return (jd - 2451545.0) / 36525.0;
}

/* ------------------------------------------------------------------ */
/*  Solar orbital elements                                             */
/* ------------------------------------------------------------------ */

/** Geometric mean longitude of the Sun (degrees, 0-360). */
export function geomMeanLongSun(T) {
    let L0 = 280.46646 + T * (36000.76983 + 0.0003032 * T);
    return ((L0 % 360) + 360) % 360;
}

/** Geometric mean anomaly of the Sun (degrees). */
export function geomMeanAnomalySun(T) {
    return 357.52911 + T * (35999.05029 - 0.0001537 * T);
}

/** Eccentricity of Earth's orbit (dimensionless). */
export function eccentricityEarth(T) {
    return 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
}

/** Sun's equation of center (degrees). */
export function sunEqOfCenter(T) {
    const M = geomMeanAnomalySun(T) * DEG;
    return Math.sin(M)     * (1.914602 - T * (0.004817 + 0.000014 * T))
         + Math.sin(2 * M) * (0.019993 - 0.000101 * T)
         + Math.sin(3 * M) * 0.000289;
}

/** Sun's true longitude (degrees). */
export function sunTrueLong(T) {
    return geomMeanLongSun(T) + sunEqOfCenter(T);
}

/** Sun's apparent longitude, corrected for nutation (degrees). */
export function sunApparentLong(T) {
    const omega = 125.04 - 1934.136 * T;
    return sunTrueLong(T) - 0.00569 - 0.00478 * Math.sin(omega * DEG);
}

/* ------------------------------------------------------------------ */
/*  Obliquity                                                          */
/* ------------------------------------------------------------------ */

/** Mean obliquity of the ecliptic (degrees). */
export function meanObliquityOfEcliptic(T) {
    const seconds = 21.448 - T * (46.8150 + T * (0.00059 - T * 0.001813));
    return 23.0 + (26.0 + seconds / 60.0) / 60.0;
}

/** Corrected obliquity (degrees). */
export function obliquityCorrection(T) {
    const omega = 125.04 - 1934.136 * T;
    return meanObliquityOfEcliptic(T) + 0.00256 * Math.cos(omega * DEG);
}

/* ------------------------------------------------------------------ */
/*  Declination & Equation of Time                                     */
/* ------------------------------------------------------------------ */

/** Solar declination (degrees). */
export function sunDeclination(T) {
    const e      = obliquityCorrection(T) * DEG;
    const lambda = sunApparentLong(T) * DEG;
    return Math.asin(Math.sin(e) * Math.sin(lambda)) * RAD;
}

/**
 * Equation of Time (minutes of time).
 *
 * The difference between apparent solar time and mean solar time.
 */
export function equationOfTime(T) {
    const eps = obliquityCorrection(T) * DEG;
    const L0  = geomMeanLongSun(T)    * DEG;
    const e   = eccentricityEarth(T);
    const M   = geomMeanAnomalySun(T) * DEG;

    let y = Math.tan(eps / 2);
    y *= y;

    const sin2L0 = Math.sin(2 * L0);
    const cos2L0 = Math.cos(2 * L0);
    const sin4L0 = Math.sin(4 * L0);
    const sinM   = Math.sin(M);
    const sin2M  = Math.sin(2 * M);

    const Etime = y * sin2L0
                - 2.0 * e * sinM
                + 4.0 * e * y * sinM * cos2L0
                - 0.5 * y * y * sin4L0
                - 1.25 * e * e * sin2M;

    return 4.0 * Etime * RAD;          // radians → minutes
}

/* ------------------------------------------------------------------ */
/*  Hour angle and rise / set helpers                                  */
/* ------------------------------------------------------------------ */

/**
 * Hour angle of sunrise for a given latitude and solar declination.
 * Uses the standard solar zenith of 90.833° (includes refraction +
 * solar semi-diameter).  Returns degrees, or NaN for polar day/night.
 */
export function hourAngleSunrise(lat, declination) {
    const latR  = lat * DEG;
    const declR = declination * DEG;
    const cosHA = (Math.cos(90.833 * DEG) / (Math.cos(latR) * Math.cos(declR)))
                - Math.tan(latR) * Math.tan(declR);
    if (cosHA > 1 || cosHA < -1)
        return NaN;                     // polar night or polar day
    return Math.acos(cosHA) * RAD;
}

/* ------------------------------------------------------------------ */
/*  Formatting helpers                                                 */
/* ------------------------------------------------------------------ */

/**
 * Convert fractional minutes-since-midnight to "HH:MM" string,
 * returning null when the input is not a finite number.
 */
export function minutesToTimeStr(minutes) {
    if (!Number.isFinite(minutes))
        return null;
    // Clamp to 0..1440
    minutes = ((minutes % 1440) + 1440) % 1440;
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Format a duration given in fractional minutes as "HHh MMm".
 */
export function formatDuration(minutes) {
    if (!Number.isFinite(minutes) || minutes < 0)
        return null;
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return `${h}h ${String(m).padStart(2, '0')}m`;
}

/* ------------------------------------------------------------------ */
/*  Public API — single-call entry point                               */
/* ------------------------------------------------------------------ */

/**
 * Compute every solar datum for a given geographic position and instant.
 *
 * @param {number} lat   Latitude  (decimal degrees, north positive)
 * @param {number} lon   Longitude (decimal degrees, east positive)
 * @param {Date}   date  JavaScript Date object (local time)
 * @returns {object}     Solar data bundle (see fields below)
 */
export function getSolarData(lat, lon, date) {
    const year    = date.getFullYear();
    const month   = date.getMonth() + 1;
    const day     = date.getDate();
    const hours   = date.getHours();
    const minutes = date.getMinutes();
    const seconds = date.getSeconds();

    /* Timezone offset in hours, east-positive (e.g. CET → +1). */
    const tz = -date.getTimezoneOffset() / 60;

    /* Julian Day at calendar midnight (local). */
    const jd0 = julianDay(year, month, day);

    /* Fractional day (local clock time as fraction of 24 h). */
    const dayFrac = (hours + minutes / 60 + seconds / 3600) / 24;

    /* Julian Century for the current instant (UT-based). */
    const T = julianCentury(jd0 + dayFrac - tz / 24);

    /* Core quantities. */
    const eqTime = equationOfTime(T);
    const decl   = sunDeclination(T);

    /* --- Sunrise / sunset / noon (minutes since local midnight) --- */
    const noonMin = 720 - 4 * lon - eqTime + tz * 60;

    const haSunrise = hourAngleSunrise(lat, decl);
    let sunriseMin = NaN;
    let sunsetMin  = NaN;
    let dayLenMin  = NaN;

    let polarDay   = false;
    let polarNight = false;

    if (Number.isFinite(haSunrise)) {
        sunriseMin = noonMin - haSunrise * 4;
        sunsetMin  = noonMin + haSunrise * 4;
        dayLenMin  = 2 * haSunrise * 4;
    } else {
        /* Determine whether it is polar day or polar night by
         * checking whether the sun is above or below the horizon
         * at solar noon. */
        const noonDecl = decl * DEG;
        const latR     = lat * DEG;
        const maxElev  = (90 - Math.abs(lat - decl));
        if (maxElev > 0) {
            polarDay  = true;
            dayLenMin = 1440;
        } else {
            polarNight = true;
            dayLenMin  = 0;
        }
    }

    /* --- Current solar position (azimuth & elevation) --- */

    /* True Solar Time (minutes since midnight). */
    const tst = (hours * 60 + minutes + seconds / 60)
              + eqTime + 4 * lon - 60 * tz;

    /* Hour Angle in degrees (negative before noon, positive after). */
    let ha = tst / 4 - 180;

    const latR   = lat * DEG;
    const declR  = decl * DEG;
    const haR    = ha * DEG;

    /* Zenith angle. */
    const cosZenith = Math.sin(latR) * Math.sin(declR)
                    + Math.cos(latR) * Math.cos(declR) * Math.cos(haR);
    const zenith    = Math.acos(Math.min(1, Math.max(-1, cosZenith))) * RAD;

    /* Elevation (complement of zenith). */
    const elevation = 90 - zenith;

    /* Azimuth (measured clockwise from north). */
    let azimuth;
    const sinZenith = Math.sin(zenith * DEG);
    if (Math.abs(sinZenith) < 1e-10) {
        /* Sun is at zenith or nadir — azimuth is indeterminate. */
        azimuth = 0;
    } else {
        const cosAz = (Math.sin(latR) * cosZenith - Math.sin(declR))
                    / (Math.cos(latR) * sinZenith);
        const clampedCosAz = Math.min(1, Math.max(-1, cosAz));
        if (ha > 0) {
            azimuth = (Math.acos(clampedCosAz) * RAD + 180) % 360;
        } else {
            azimuth = (540 - Math.acos(clampedCosAz) * RAD) % 360;
        }
    }

    /* --- Assemble result --- */
    return {
        elevation,
        azimuth,
        declination: decl,
        eqTime,
        hourAngle: ha,

        sunriseMin,
        sunsetMin,
        noonMin,
        dayLenMin,

        sunrise:   minutesToTimeStr(sunriseMin),
        sunset:    minutesToTimeStr(sunsetMin),
        solarNoon: minutesToTimeStr(noonMin),
        dayLength: formatDuration(dayLenMin),

        polarDay,
        polarNight,
    };
}

/**
 * Compute elevation and azimuth at a specific clock time for a given
 * position — useful for plotting the daily trajectory.
 *
 * @param {number} lat        Latitude
 * @param {number} lon        Longitude
 * @param {Date}   baseDate   Any Date on the target calendar day
 * @param {number} clockMin   Minutes since local midnight (0-1440)
 * @returns {{elevation: number, azimuth: number}}
 */
export function positionAtMinute(lat, lon, baseDate, clockMin) {
    const d = new Date(
        baseDate.getFullYear(),
        baseDate.getMonth(),
        baseDate.getDate(),
        0, 0, 0,
    );
    d.setMinutes(clockMin);
    const data = getSolarData(lat, lon, d);
    return {elevation: data.elevation, azimuth: data.azimuth};
}
