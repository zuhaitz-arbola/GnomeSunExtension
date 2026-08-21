# Gnome Sun Extension ☀

> **Version:** 1.0.0 | **GNOME Shell:** 46

**Gnome Sun Extension** is a GNOME Shell extension that displays the real-time solar position in the top panel.

Part of **Jakin | Athenaeum** — *A free knowledge desktop ecosystem for science, philosophy, and art.*

It offline-calculates the sunrise, sunset, solar noon, day length, elevation, and azimuth using astronomical equations (NOAA Solar Calculator) based on your local coordinates. No external web requests are ever made.

---

## Features

- **Top Bar Icon**: Minimalist solar indicator showing current solar altitude relative to the horizon.
- **Detailed Sky Dome**: Center-projected polar chart illustrating the sun's path during the day and its current coordinate position.
- **Astronomic Information**: Detailed calculations of sunrise, sunset, solar noon, day length, elevation, and azimuth.
- **Settings & Documentation**: A native Libadwaita Preferences window featuring configuration options, a detailed Information page with astronomical explanations, and an About section.
- **Cairo Vector Rendering**: Uses Cairo with vector drawing for a dynamic and interactive visual representation.
- **Completely Offline**: Runs 100% locally to protect your privacy and ensure lightweight resource utilization.

---

## Panel Ordering and Ergonomics

The three astronomical extensions (Gnome Sun Extension, Gnome Moon Extension, and Gnome Planetarium Extension) feature an automatic sibling-ordering mechanism that guarantees a deterministic left-to-right sequence to the left of system status indicators:

`Gnome Sun Extension → Gnome Moon Extension → Gnome Planetarium Extension`

This spatial hierarchy respects Western left-to-right reading direction, human intuition, and cognitive ergonomics: starting at the daily solar cycle (primary circadian anchor), moving through Earth's immediate satellite (the Moon), and concluding at the macroscopic heliocentric scale (the Solar System), aiming to make the interface feel more fluid.

---

## Supported Languages (3 languages)

GnomeSun is fully translated into the following languages:

- **Basque** (`eu`)
- **English** (`en`)
- **Spanish** (`es`)

---

## Installation

Copy the extension directory to your GNOME Shell extensions directory:

```bash
cp -r GnomeSunExtension ~/.local/share/gnome-shell/extensions/gnomesunextension@aiurri.xyz
```

---

## Activation

### Via terminal:

```bash
gnome-extensions enable gnomesunextension@aiurri.xyz
```

### Via GUI:
Open **GNOME Extensions** or **Extension Manager** and toggle *Gnome Sun Extension* on.

> **Note:** If on Wayland, you must log out and log back in to reload GNOME Shell before the extension becomes visible. On X11, you can restart it by typing `Alt+F2`, typing `r`, and hitting `Enter`.

---

## Configuration

1. Open the preferences of the extension (click on the gear icon in the Extensions app, or click *Settings* from the extension's top bar drop-down).
2. Enter your **latitude** and **longitude** in decimal degrees.
3. Configure the **refresh interval** (default is 60 seconds).

---

## License

GPL-3.0-or-later

---

## Credits

- Solar calculations based on equations from the [NOAA Solar Calculator](https://gml.noaa.gov/grad/solcalc/).

- Original idea by [Zuhaitz (Alberto V. I.)](http://www.aiurri.xyz), created with Google's Antigravity and VSCodium.
