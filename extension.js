/**
 * extension.js — Gnome Sun Extension GNOME Shell Extension
 *
 * Renders the current solar position in the top panel using
 * St.DrawingArea + Cairo, and shows a detailed sky-dome diagram
 * with azimuth, elevation, sunrise/sunset data in a popup menu.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import GLib   from 'gi://GLib';
import Gio    from 'gi://Gio';
import GObject from 'gi://GObject';
import St     from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango   from 'gi://Pango';
import Cairo   from 'cairo';


import * as Main      from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

/* Local solar calculation module. */
import * as Solar from './solar.js';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const TWO_PI = 2 * Math.PI;
const DEG    = Math.PI / 180;

/* Panel icon dimensions. */
const ICON_W = 22;
const ICON_H = 22;

/* Sky-dome popup dimensions. */
const DOME_W = 290;
const DOME_H = 240;

/* Number of trajectory sample points (every 10 min = 144). */
const TRAJ_STEPS = 144;

/* ------------------------------------------------------------------ */
/*  Colour palette                                                     */
/* ------------------------------------------------------------------ */

const C = {
    /* Background / dome (Pure Black #000000) */
    domeBg:     [0.00, 0.00, 0.00, 1.0],
    domeRing:   [0.56, 0.58, 0.65, 0.50],
    domeGrid:   [1.00, 1.00, 1.00, 0.25],

    /* Compass labels (Pure White #FFFFFF) */
    compass:    [1.00, 1.00, 1.00, 0.95],

    /* Trajectory arc (Pure White) */
    trajDay:    [1.00, 1.00, 1.00, 1.0],

    /* Current sun dot (Pure White) */
    sunCore:    [1.00, 1.00, 1.00, 1.0],
    sunGlow:    [1.00, 1.00, 1.00, 0.35],

    /* Elevation arcs labels (Pure White) */
    elevLabel:  [1.00, 1.00, 1.00, 0.60],
};

/* ------------------------------------------------------------------ */
/*  SunIndicator — PanelMenu.Button subclass                           */
/* ------------------------------------------------------------------ */

const SunIndicator = GObject.registerClass(
class SunIndicator extends PanelMenu.Button {

    _init(ext) {
        super._init(0.5, 'Gnome Sun Extension');
        this.add_style_class_name("gnomesun-panel-button");

        this._ext      = ext;
        this._settings = ext.getSettings();
        this._solarData = null;
        this._timerId   = 0;

        /* ----- Panel icon (DrawingArea) ----- */
        this._panelIcon = new St.DrawingArea({
            style_class: 'gnomesun-panel-icon',
            width:  ICON_W,
            height: ICON_H,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._panelIcon.connect('repaint', (area) => this._drawPanelIcon(area));
        this.add_child(this._panelIcon);

        /* ----- Popup menu ----- */
        this._buildPopupMenu();

        /* ----- Settings signals ----- */
        this._settingsIds = [];
        this._settingsIds.push(
            this._settings.connect('changed::latitude',         () => this._update()),
            this._settings.connect('changed::longitude',        () => this._update()),
            this._settings.connect('changed::refresh-interval', () => this._restartTimer()),
        );

        /* ----- Theme Detection (GNOME Official Light/Dark Mode) ----- */
        this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
        this._themeSettingsId = this._interfaceSettings.connect(
            'changed::color-scheme',
            () => this._updateTheme()
        );
        this._updateTheme();

        /* ----- Initial update & timer ----- */
        this._update();
        this._startTimer();
    }

    /* ============================================================== */
    /*  Popup menu construction                                        */
    /* ============================================================== */

    _buildPopupMenu() {
        /* Sky-dome diagram. */
        this._domeArea = new St.DrawingArea({
            style_class: 'gnomesun-sky-dome',
            width:  DOME_W,
            height: DOME_H,
        });
        this._domeArea.connect('repaint', (area) => this._drawSkyDome(area));

        const domeItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        domeItem.add_child(this._domeArea);
        this.menu.addMenuItem(domeItem);

        /* Separator. */
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        /* Info rows container. */
        this._infoBox = new St.BoxLayout({
            vertical: true,
            style_class: 'gnomesun-info-box',
            x_expand: true,
        });
        const infoItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        infoItem.add_child(this._infoBox);
        this.menu.addMenuItem(infoItem);

        /* Top Status Card ("Horizontearen gainean") inside infoBox */
        this._statusContainer = new St.BoxLayout({
            style_class: 'gnomeastro-visible-badge',
            width: 232,
            clip_to_allocation: true,
        });
        this._statusHeader = new St.Label({
            style_class: 'gnomeastro-badge-header',
            x_expand: true,
        });
        this._statusHeader.clutter_text.line_wrap = false;
        this._statusContainer.add_child(this._statusHeader);
        this._infoBox.add_child(this._statusContainer);

        /* Pre-create info row widgets. */
        this._rows = {};
        const fields = [
            ['sunrise',    _('Sunrise')],
            ['sunset',     _('Sunset')],
            ['solarNoon',  _('Solar Noon')],
            ['dayLength',  _('Day Length')],
            ['elevation',  _('Elevation')],
            ['azimuth',    _('Azimuth')],
        ];
        for (const [key, label] of fields) {
            const row = new St.BoxLayout({style_class: 'gnomesun-info-row', x_expand: true});
            const lbl = new St.Label({style_class: 'gnomesun-info-label', text: label, x_expand: true, x_align: Clutter.ActorAlign.START});
            const val = new St.Label({style_class: 'gnomesun-info-value', text: '—', x_expand: true, x_align: Clutter.ActorAlign.END});
            row.add_child(lbl);
            row.add_child(val);
            this._infoBox.add_child(row);
            this._rows[key] = val;
        }

        /* Separator before footer block */
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        /* Circular Icon Buttons Row (Help + Settings) - GNOME Quick Settings style */
        const footerRow = new St.BoxLayout({
            style_class: 'gnomeastro-footer-row',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        });

        /* 1. Help Circular Button */
        const helpBtn = new St.Button({
            style_class: 'gnomeastro-footer-btn',
            child: new St.Icon({
                icon_name: 'help-about-symbolic',
                icon_size: 16,
            }),
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        helpBtn.connect('clicked', () => {
            try {
                GLib.file_set_contents('/tmp/gnome_astro_tab.txt', 'help');
            } catch (e) {}
            this._ext.openPreferences();
        });

        /* 2. Settings Circular Button */
        const settingsBtn = new St.Button({
            style_class: 'gnomeastro-footer-btn',
            child: new St.Icon({
                icon_name: 'emblem-system-symbolic',
                icon_size: 16,
            }),
            y_align: Clutter.ActorAlign.CENTER,
            x_align: Clutter.ActorAlign.CENTER,
        });
        settingsBtn.connect('clicked', () => {
            try {
                GLib.file_set_contents('/tmp/gnome_astro_tab.txt', 'config');
            } catch (e) {}
            this._ext.openPreferences();
        });

        footerRow.add_child(helpBtn);
        footerRow.add_child(settingsBtn);

        const footerItem = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
        });
        footerItem.add_child(footerRow);
        this.menu.addMenuItem(footerItem);

        /* Fade-in popover & Heartbeat timer */
        this.menu.connect('open-state-changed', (menu, isOpen) => {
            if (isOpen) {
                this.menu.box.opacity = 0;
                this.menu.box.ease({
                    opacity: 255,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                
                this._heartbeatId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    if (this._domeArea) this._domeArea.queue_repaint();
                    return GLib.SOURCE_CONTINUE;
                });
            } else {
                if (this._heartbeatId) {
                    GLib.source_remove(this._heartbeatId);
                    this._heartbeatId = null;
                }
            }
        });
    }

    /* ============================================================== */
    /*  Theme Detection                                               */
    /* ============================================================== */

    _isLightMode() {
        try {
            const scheme = this._interfaceSettings.get_string('color-scheme');
            return scheme === 'prefer-light' || scheme === 'default';
        } catch (e) {
            return false;
        }
    }

    _updateTheme() {
        const isLight = this._isLightMode();
        if (isLight) {
            this.add_style_class_name('light-mode');
            this.remove_style_class_name('dark-mode');
            if (this.menu && this.menu.box) {
                this.menu.box.add_style_class_name('light-mode');
                this.menu.box.remove_style_class_name('dark-mode');
            }
        } else {
            this.add_style_class_name('dark-mode');
            this.remove_style_class_name('light-mode');
            if (this.menu && this.menu.box) {
                this.menu.box.add_style_class_name('dark-mode');
                this.menu.box.remove_style_class_name('light-mode');
            }
        }
        if (this._panelIcon) this._panelIcon.queue_repaint();
        if (this._domeArea) this._domeArea.queue_repaint();
    }

    /* ============================================================== */
    /*  Timer management                                               */
    /* ============================================================== */

    _startTimer() {
        if (this._timerId)
            return;
        const interval = this._settings.get_int('refresh-interval');
        this._timerId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, interval, () => {
                this._update();
                return GLib.SOURCE_CONTINUE;
            },
        );
    }

    _stopTimer() {
        if (this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    _restartTimer() {
        this._stopTimer();
        this._startTimer();
    }

    /* ============================================================== */
    /*  Data update                                                    */
    /* ============================================================== */

    _isConfigured() {
        const lat = this._settings.get_double('latitude');
        const lon = this._settings.get_double('longitude');
        return (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180);
    }

    _update() {
        if (!this._isConfigured()) {
            this._solarData = null;
            this._statusLabel.set_style_class_name('gnomesun-status-label');
            this._statusLabel.set_text(_('Coordinates not configured'));
            this._infoBox.hide();
        } else {
            const lat = this._settings.get_double('latitude');
            const lon = this._settings.get_double('longitude');
            this._solarData = Solar.getSolarData(lat, lon, new Date());

            /* Update status card (single continuous line). */
                        const isDay = this._solarData.elevation > 0;
            let statusText = isDay ? _("Sun above horizon") : _("Sun below horizon");
            this._statusHeader.set_text(statusText);

            /* Update info rows. */
            this._infoBox.show();
            const d = this._solarData;
            this._rows.elevation.set_text(`${d.elevation.toFixed(2)}°`);
            this._rows.azimuth.set_text(`${d.azimuth.toFixed(2)}°`);
            this._rows.sunrise.set_text(d.sunrise  ?? '—');
            this._rows.sunset.set_text(d.sunset   ?? '—');
            this._rows.solarNoon.set_text(d.solarNoon ?? '—');
            this._rows.dayLength.set_text(d.dayLength ?? '—');
        }

        /* Trigger Cairo repaints. */
        this._panelIcon.queue_repaint();
        this._domeArea.queue_repaint();
    }

    /* ============================================================== */
    /*  Cairo: panel icon (small sun + horizon)                        */
    /* ============================================================== */

    _drawPanelIcon(area) {
        const cr  = area.get_context();
        const [w, h] = area.get_surface_size();

        const cx = w / 2;
        const cy = h / 2;
        
        /* --- Nuevas proporciones: Sol dominante, rayos sutiles --- */
        // El radio del sol es grande para ocupar el panel (max ~11)
        const sunR = 7.0;  

        /* Clear canvas. */
        cr.setOperator(0);   // CLEAR
        cr.paint();
        cr.setOperator(2);   // OVER

        if (!this._solarData) {
            // Dim placeholder if unconfigured
            cr.setSourceRGBA(1.0, 1.0, 1.0, 0.3);
            cr.arc(cx, cy, sunR * 0.6, 0, TWO_PI);
            cr.stroke();
            cr.$dispose();
            return;
        }

        const isDay = this._solarData.elevation > 0;
        // Force pure white for minimalist look
        cr.setSourceRGBA(1.0, 1.0, 1.0, 1.0);

        if (isDay) {
            /* Daytime: Solid large Sun disc */
            cr.arc(cx, cy, sunR, 0, TWO_PI);
            cr.fill();

            /* Daytime: 8 Minimalist Rays */
            // Los rayos deben ser pequeños en relación al sol grande
            cr.setLineWidth(1.2);
            const rLen = 1.5; // Longitud: la mitad del radio del sol (7.0)
            const rGap = 1.0; // Espacio muy pequeño desde el sol

            for (let a = 0; a < 8; a++) {
                const angle = a * Math.PI / 4;
                // Empezamos a dibujar justo fuera del sol
                const startDist = sunR + rGap;
                cr.moveTo(cx + Math.cos(angle) * startDist, cy + Math.sin(angle) * startDist);
                cr.lineTo(cx + Math.cos(angle) * (startDist + rLen), cy + Math.sin(angle) * (startDist + rLen));
                cr.stroke();
            }

        } else {
            /* Nighttime: Large Sun Outline (minimalist) */
            cr.setLineWidth(1.0);
            cr.arc(cx, cy, sunR, 0, TWO_PI);
            cr.stroke();
        }

        cr.$dispose();
    }

    /* ============================================================== */
    /*  Cairo: sky-dome popup diagram                                  */
    /* ============================================================== */

    /**
     * Map (azimuth, elevation) → (x, y) on the polar sky dome.
     *
     *   • Centre = zenith (elevation 90°)
     *   • Edge   = horizon (elevation 0°)
     *   • Azimuth 0° = North (top), 90° = East (right)
     */
    _domeXY(azimuth, elevation, cx, cy, radius) {
        const r = ((90 - Math.max(0, elevation)) / 90) * radius;
        const a = azimuth * DEG;
        return [cx + r * Math.sin(a), cy - r * Math.cos(a)];
    }

    _drawSkyDome(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();

        /* Clear. */
        cr.setOperator(0);
        cr.paint();
        cr.setOperator(2);

        /* Background. */
        /* Rounded rectangle (manual, since Clutter's Cairo has no built-in). */
        const bgR = 10;
        cr.newPath();
        cr.arc(bgR,     bgR,      bgR, Math.PI, 1.5 * Math.PI);
        cr.arc(w - bgR, bgR,      bgR, 1.5 * Math.PI, TWO_PI);
        cr.arc(w - bgR, h - bgR,  bgR, 0, 0.5 * Math.PI);
        cr.arc(bgR,     h - bgR,  bgR, 0.5 * Math.PI, Math.PI);
        cr.closePath();
        cr.clipPreserve();

        const cx = w / 2;
        const cy = h / 2;
        const radius = Math.min(w, h) / 2 - 32;

        const isLight = this._isLightMode();
        const isDayForBg = this._solarData && this._solarData.elevation > 0;
        if (isLight) {
            if (isDayForBg) {
                const bgPat = new Cairo.RadialGradient(cx, cy, 0, cx, cy, radius + 16);
                bgPat.addColorStopRGBA(0, 0.50, 0.65, 0.85, 1.0);
                bgPat.addColorStopRGBA(1, 0.72, 0.72, 0.72, 1.0);
                cr.setSource(bgPat);
            } else {
                cr.setSourceRGBA(0.72, 0.72, 0.72, 1.0);
            }
        } else if (isDayForBg) {
            const bgPat = new Cairo.RadialGradient(cx, cy, 0, cx, cy, radius + 16);
            bgPat.addColorStopRGBA(0, 0.05, 0.08, 0.18, 1.0);
            bgPat.addColorStopRGBA(1, 0.0, 0.0, 0.0, 1.0);
            cr.setSource(bgPat);
        } else {
            cr.setSourceRGBA(...C.domeBg);
        }
        cr.fill();
        cr.resetClip();

        /* ---- Horizon circle ---- */
        if (isLight) {
            cr.setSourceRGBA(0.36, 0.38, 0.42, 0.65);
        } else {
            cr.setSourceRGBA(...C.domeRing);
        }
        cr.setLineWidth(1.5);
        cr.arc(cx, cy, radius, 0, TWO_PI);
        cr.stroke();

        /* ---- Crepuscular Horizon Glow ---- */
        if (this._solarData && this._solarData.elevation >= -6 && this._solarData.elevation <= 10) {
            const [glowX, glowY] = this._domeXY(this._solarData.azimuth, 0, cx, cy, radius);
            const glowPat = new Cairo.RadialGradient(glowX, glowY, 0, glowX, glowY, 4);
            glowPat.addColorStopRGBA(0, 1.0, 0.70, 0.30, 0.15);
            glowPat.addColorStopRGBA(1, 1.0, 0.70, 0.30, 0.0);
            cr.setSource(glowPat);
            cr.arc(glowX, glowY, 4, 0, TWO_PI);
            cr.fill();
        }

        /* ---- Elevation circles (30° and 60°) ---- */
        if (isLight) {
            cr.setSourceRGBA(0.36, 0.38, 0.42, 0.45);
        } else {
            cr.setSourceRGBA(...C.domeGrid);
        }
        cr.setLineWidth(0.6);
        cr.setDash([], 0);
        cr.arc(cx, cy, radius * (2 / 3), 0, TWO_PI);   // 30°
        cr.stroke();
        cr.arc(cx, cy, radius * (1 / 3), 0, TWO_PI);   // 60°
        cr.stroke();

        /* ---- Cross-hairs (N-S, E-W) ---- */
        if (isLight) {
            cr.setSourceRGBA(0.36, 0.38, 0.42, 0.45);
        } else {
            cr.setSourceRGBA(...C.domeGrid);
        }
        cr.setLineWidth(0.5);
        cr.moveTo(cx, cy - radius);
        cr.lineTo(cx, cy + radius);
        cr.stroke();
        cr.moveTo(cx - radius, cy);
        cr.lineTo(cx + radius, cy);
        cr.stroke();

        /* ---- Compass labels ---- */
        if (isLight) {
            cr.setSourceRGBA(0.18, 0.20, 0.21, 1.0); // Negro exacto GNOME #2e3436
        } else {
            cr.setSourceRGBA(...C.compass);
        }
        cr.selectFontFace('Sans', 0, 1);   // NORMAL, BOLD
        cr.setFontSize(10);

        let ext;
        const lblN = _('N');
        ext = cr.textExtents(lblN);
        cr.moveTo(cx - ext.width / 2, cy - radius - 6);
        cr.showText(lblN);

        const lblS = _('S');
        ext = cr.textExtents(lblS);
        cr.moveTo(cx - ext.width / 2, cy + radius + 14);
        cr.showText(lblS);

        const lblE = _('E');
        ext = cr.textExtents(lblE);
        cr.moveTo(cx + radius + 7, cy + ext.height / 2);
        cr.showText(lblE);

        const lblW = _('W');
        ext = cr.textExtents(lblW);
        cr.moveTo(cx - radius - 7 - ext.width, cy + ext.height / 2);
        cr.showText(lblW);

        /* ---- Elevation labels (30°, 60°) ---- */
        if (isLight) {
            cr.setSourceRGBA(0.36, 0.38, 0.42, 0.85); // Gris exacto GNOME #5c616c
        } else {
            cr.setSourceRGBA(...C.elevLabel);
        }
        cr.selectFontFace('Sans', 0, 0);   // NORMAL, NORMAL
        cr.setFontSize(10);
        cr.moveTo(cx + 3, cy - radius * (1 / 3) + 11);
        cr.showText('60°');
        cr.moveTo(cx + 3, cy - radius * (2 / 3) + 11);
        cr.showText('30°');

        if (!this._solarData) {
            /* No data — draw "?" in centre. */
            cr.setSourceRGBA(0.6, 0.6, 0.6, 0.5);
            cr.selectFontFace('Sans', 0, 1);
            cr.setFontSize(28);
            ext = cr.textExtents('?');
            cr.moveTo(cx - ext.width / 2, cy + ext.height / 2);
            cr.showText('?');
            cr.$dispose();
            return;
        }

        /* ---- Sun trajectory for the day ---- */
        const lat = this._settings.get_double('latitude');
        const lon = this._settings.get_double('longitude');
        const now = new Date();

        /* Collect trajectory points for the day. */
        const points = [];
        for (let i = 0; i <= TRAJ_STEPS; i++) {
            const min = i * (1440 / TRAJ_STEPS);
            const pos = Solar.positionAtMinute(lat, lon, now, min);
            points.push(pos);
        }

        /* Above-horizon trajectory arc. */
        cr.setLineWidth(1.5);

        const lerpColor = (c1, c2, t) => c1.map((v, i) => v + (c2[i] - v) * Math.max(0, Math.min(1, t)));
        const getArcColor = (elev) => {
            if (elev <= 5) return [1.0, 0.65, 0.25, 0.8];
            if (elev <= 30) return lerpColor([1.0, 0.65, 0.25, 0.8], [1.0, 0.85, 0.55, 0.9], (elev - 5) / 25);
            if (elev <= 60) return lerpColor([1.0, 0.85, 0.55, 0.9], [1.0, 0.95, 0.80, 0.95], (elev - 30) / 30);
            return lerpColor([1.0, 0.95, 0.80, 0.95], [1.0, 1.0, 1.0, 1.0], Math.min(1, (elev - 60) / 30));
        };

        let prevP = null;
        for (const p of points) {
            if (p.elevation < 0) {
                prevP = null;
                continue;
            }
            const [x, y] = this._domeXY(p.azimuth, p.elevation, cx, cy, radius);
            if (prevP) {
                cr.moveTo(prevP.x, prevP.y);
                cr.lineTo(x, y);
                const midElev = (prevP.elevation + p.elevation) / 2;
                cr.setSourceRGBA(...getArcColor(midElev));
                cr.stroke();
            }
            prevP = { x, y, elevation: p.elevation };
        }

        /* ---- Current sun position (only above horizon) ---- */
        const sd    = this._solarData;
        const isDay = sd.elevation > 0;

        if (isDay) {
            const [sunX, sunY] = this._domeXY(sd.azimuth, sd.elevation, cx, cy, radius);

            /* Outer glow. */
            cr.setSourceRGBA(...C.sunGlow);
            cr.arc(sunX, sunY, 10, 0, TWO_PI);
            cr.fill();
            cr.setSourceRGBA(...C.sunGlow);
            cr.arc(sunX, sunY, 6, 0, TWO_PI);
            cr.fill();

            /* Core dot. */
            cr.setSourceRGBA(...C.sunCore);
            cr.arc(sunX, sunY, 4.5, 0, TWO_PI);
            cr.fill();

            /* Tiny cross-hair. */
            cr.setSourceRGBA(1.0, 1.0, 1.0, 0.45);
            cr.setLineWidth(0.6);
            cr.moveTo(sunX - 7, sunY);
            cr.lineTo(sunX + 7, sunY);
            cr.stroke();
            cr.moveTo(sunX, sunY - 7);
            cr.lineTo(sunX, sunY + 7);
            cr.stroke();
        }

        /* Heartbeat indicator */
        const alpha = 0.325 + 0.175 * Math.sin(Date.now() / 1000 * Math.PI);
        if (isLight) {
            cr.setSourceRGBA(0.18, 0.20, 0.21, alpha);
        } else {
            cr.setSourceRGBA(1.0, 1.0, 1.0, alpha);
        }
        cr.arc(w - 12, h - 12, 2.5, 0, TWO_PI);
        cr.fill();

        cr.$dispose();
    }

    /* ============================================================== */
    /*  Cleanup                                                       */
    /* ============================================================== */

    destroy() {
        if (this._themeSettingsId && this._interfaceSettings) {
            this._interfaceSettings.disconnect(this._themeSettingsId);
            this._themeSettingsId = 0;
        }
        this._stopTimer();
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        super.destroy();
    }
});

/* ================================================================== */
/*  Extension entry point                                              */
/* ================================================================== */

export default class GnomeSunExtension extends Extension {

    enable() {
        this.initTranslations();
        this._indicator = new SunIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
        this._orderTrio();
    }

    _orderTrio() {
        try {
            const rightBox = Main.panel._rightBox;
            const sa = Main.panel.statusArea;

            const sunActor = (sa['gnomesunextension@aiurri.xyz'] || sa['gnomesun@aiurri.xyz'])?.container ||
                             (sa['gnomesunextension@aiurri.xyz'] || sa['gnomesun@aiurri.xyz']);
            const moonActor = (sa['gnomemoonextension@aiurri.xyz'] || sa['gnomemoon@aiurri.xyz'])?.container ||
                              (sa['gnomemoonextension@aiurri.xyz'] || sa['gnomemoon@aiurri.xyz']);
            const planActor = (sa['gnomeplanetariumextension@aiurri.xyz'] || sa['gnomeorrery@aiurri.xyz'])?.container ||
                              (sa['gnomeplanetariumextension@aiurri.xyz'] || sa['gnomeorrery@aiurri.xyz']);

            if (sunActor && moonActor)
                rightBox.set_child_above_sibling(moonActor, sunActor);
            if (moonActor && planActor)
                rightBox.set_child_above_sibling(planActor, moonActor);
            else if (sunActor && planActor)
                rightBox.set_child_above_sibling(planActor, sunActor);
        } catch (e) {}
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
