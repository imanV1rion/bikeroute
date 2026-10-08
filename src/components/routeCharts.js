/**
 * Trip Weather System - Route Charts Component
 * High-performance SVG visualizer for route elevation, comfort score profile,
 * wind vectors along kilometers, and departure timeline matrix.
 */

export class RouteVisualizer {
  constructor(profileContainerId, departureContainerId) {
    this.profileContainer = document.getElementById(profileContainerId);
    this.departureContainer = document.getElementById(departureContainerId);
  }

  /**
   * Renders the route profile showing elevation, comfort score, and wind hazards along kilometers.
   */
  renderProfile(scoredPoints, totalDistKm, onPointSelect) {
    if (!this.profileContainer || !scoredPoints || scoredPoints.length < 2) return;

    const width = this.profileContainer.clientWidth || 700;
    const height = 180;
    const padding = { top: 25, right: 30, bottom: 35, left: 45 };

    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    // Determine min/max values
    const maxDist = Math.max(totalDistKm, scoredPoints[scoredPoints.length - 1].distanceKm);
    const hasElevation = scoredPoints.some(p => p.elevationM !== null && p.elevationM !== undefined && !isNaN(p.elevationM));
    const validElevs = scoredPoints.filter(p => p.elevationM !== null && p.elevationM !== undefined && !isNaN(p.elevationM)).map(p => p.elevationM);
    const minElev = validElevs.length > 0 ? Math.min(...validElevs) : 0;
    const maxElev = validElevs.length > 0 ? Math.max(...validElevs) : 100;

    const getX = (km) => padding.left + (km / maxDist) * plotW;
    const getYScore = (score) => padding.top + plotH - (score / 100) * plotH;
    const getYElev = (elev) => {
      const e = (elev !== null && elev !== undefined && !isNaN(elev)) ? elev : minElev;
      return padding.top + plotH - ((e - minElev) / (maxElev - minElev || 1)) * (plotH * 0.7);
    };

    // Build SVG paths
    let elevPath = hasElevation ? `M ${getX(scoredPoints[0].distanceKm)} ${padding.top + plotH}` : '';
    let scorePath = `M ${getX(scoredPoints[0].distanceKm)} ${getYScore(scoredPoints[0].pointScore)}`;

    scoredPoints.forEach(pt => {
      const x = getX(pt.distanceKm);
      const yE = getYElev(pt.elevationM);
      const yS = getYScore(pt.pointScore);
      if (hasElevation) elevPath += ` L ${x} ${yE}`;
      scorePath += ` L ${x} ${yS}`;
    });

    if (hasElevation) {
      elevPath += ` L ${getX(scoredPoints[scoredPoints.length - 1].distanceKm)} ${padding.top + plotH} Z`;
    }

    const html = `
      <div class="chart-wrapper">
        <div class="chart-header">
          <div class="chart-title">Route Topography & Comfort Profile</div>
          <div class="chart-legend">
            <span class="legend-item"><span class="swatch elev"></span> ${hasElevation ? `Elevation (${minElev}m - ${maxElev}m)` : 'Elevation unavailable'}</span>
            <span class="legend-item"><span class="swatch score"></span> Comfort Score (0 - 100)</span>
            <span class="legend-item"><span class="swatch headwind"></span> Headwind / Gusts</span>
          </div>
        </div>

        <svg viewBox="0 0 ${width} ${height}" class="profile-svg" preserveAspectRatio="none">
          <defs>
            <linearGradient id="elevGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#38bdf8" stop-opacity="0.35"/>
              <stop offset="100%" stop-color="#38bdf8" stop-opacity="0.02"/>
            </linearGradient>
            <linearGradient id="scoreLineGradient" x1="0" y1="0" x2="1" y2="0">
              ${scoredPoints.map((pt) => {
                const pct = (pt.distanceKm / maxDist) * 100;
                const col = this.getScoreColor(pt.pointScore);
                return `<stop offset="${pct}%" stop-color="${col}"/>`;
              }).join('')}
            </linearGradient>
          </defs>

          <!-- Grid lines -->
          <line x1="${padding.left}" y1="${getYScore(80)}" x2="${width - padding.right}" y2="${getYScore(80)}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3,3"/>
          <text x="${padding.left - 8}" y="${getYScore(80) + 4}" fill="#10b981" font-size="10" text-anchor="end">80</text>

          <line x1="${padding.left}" y1="${getYScore(50)}" x2="${width - padding.right}" y2="${getYScore(50)}" stroke="rgba(255,255,255,0.08)" stroke-dasharray="3,3"/>
          <text x="${padding.left - 8}" y="${getYScore(50) + 4}" fill="#f59e0b" font-size="10" text-anchor="end">50</text>

          <!-- Elevation Area -->
          <path d="${elevPath}" fill="url(#elevGradient)"/>

          <!-- Comfort Score Polyline -->
          <path d="${scorePath}" fill="none" stroke="url(#scoreLineGradient)" stroke-width="3" stroke-linecap="round"/>

          <!-- Point Dots and Wind Flags -->
          ${scoredPoints.map((pt, idx) => {
            const x = getX(pt.distanceKm);
            const y = getYScore(pt.pointScore);
            const col = this.getScoreColor(pt.pointScore);
            const headwind = pt.wind ? pt.wind.headwind : 0;
            const isHighHeadwind = headwind > 15;

            return `
              <g class="chart-point-node" data-index="${idx}" style="cursor: pointer;">
                <circle cx="${x}" cy="${y}" r="4.5" fill="${col}" stroke="#0f172a" stroke-width="2"/>
                ${isHighHeadwind ? `
                  <text x="${x}" y="${y - 9}" fill="#f87171" font-size="9" text-anchor="middle" font-weight="bold">⚠️ ${headwind.toFixed(0)}k</text>
                ` : ''}
              </g>
            `;
          }).join('')}

          <!-- Distance X Axis -->
          <line x1="${padding.left}" y1="${padding.top + plotH}" x2="${width - padding.right}" y2="${padding.top + plotH}" stroke="rgba(255,255,255,0.2)"/>
          <text x="${padding.left}" y="${height - 10}" fill="#94a3b8" font-size="11">0 km</text>
          <text x="${padding.left + plotW / 2}" y="${height - 10}" fill="#94a3b8" font-size="11" text-anchor="middle">${Math.round(maxDist / 2)} km</text>
          <text x="${width - padding.right}" y="${height - 10}" fill="#94a3b8" font-size="11" text-anchor="end">${Math.round(maxDist)} km</text>
        </svg>
      </div>
    `;

    this.profileContainer.innerHTML = html;

    // Attach click listeners to point nodes
    this.profileContainer.querySelectorAll('.chart-point-node').forEach(node => {
      node.addEventListener('click', () => {
        const idx = parseInt(node.getAttribute('data-index'), 10);
        if (onPointSelect && scoredPoints[idx]) {
          onPointSelect(scoredPoints[idx]);
        }
      });
    });
  }

  /**
   * Renders the 10-hour departure window optimizer matrix
   */
  renderDepartureTimeline(departureWindows, currentSelectedOffset, onSelectOffset) {
    if (!this.departureContainer || !departureWindows || departureWindows.length === 0) return;

    const maxScore = 100;
    const bestScore = Math.max(...departureWindows.map(w => w.score));

    const html = `
      <div class="departure-matrix-header">
        <div class="departure-matrix-title">10-Hour Departure Optimizer</div>
        <div class="departure-matrix-hint">Scores calculated across all route ETAs without repeated API hits</div>
      </div>
      <div class="departure-timeline-bar">
        ${departureWindows.map(w => {
          const isSelected = w.offsetHours === currentSelectedOffset;
          const isBest = w.score === bestScore && w.score > 50;
          const scoreCol = this.getScoreColor(w.score);
          const heightPercent = Math.max(18, (w.score / maxScore) * 100);

          return `
            <div class="departure-slot ${isSelected ? 'selected' : ''} ${isBest ? 'is-best' : ''}" 
                 data-offset="${w.offsetHours}" 
                 title="Departure at ${w.departureLabel} (Offset +${w.offsetHours}h) - Score: ${w.score} (${w.verdict})">
              ${isBest ? `<span class="best-badge">BEST</span>` : ''}
              <div class="slot-bar-wrap">
                <div class="slot-bar" style="height: ${heightPercent}%; background: ${scoreCol};">
                  <span class="slot-score-val">${w.score}</span>
                </div>
              </div>
              <div class="slot-time">${w.departureLabel}</div>
              <div class="slot-offset">${w.offsetHours === 0 ? 'Now' : `+${w.offsetHours}h`}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    this.departureContainer.innerHTML = html;

    this.departureContainer.querySelectorAll('.departure-slot').forEach(slot => {
      slot.addEventListener('click', () => {
        const offset = parseInt(slot.getAttribute('data-offset'), 10);
        if (onSelectOffset) onSelectOffset(offset);
      });
    });
  }

  getScoreColor(score) {
    if (score >= 80) return '#10b981'; // emerald
    if (score >= 60) return '#f59e0b'; // amber
    if (score >= 40) return '#f97316'; // orange
    return '#ef4444'; // crimson red
  }
}
