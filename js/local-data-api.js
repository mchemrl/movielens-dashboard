// ============================================================
// Local data "API" — computes the exact same response shapes the real
// FastAPI backend returns, but entirely in the browser from the embedded
// DATA dataset (see data.js). No network requests anywhere in this
// file, so this whole app works from a plain file:// double-click, with
// zero server and zero backend, as a standalone fallback build.
// ============================================================

function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function std(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function filterRatings(yearFrom, yearTo) {
  return DATA.ratings.filter(([, , , year]) =>
    (yearFrom == null || year >= yearFrom) && (yearTo == null || year <= yearTo)
  );
}

const MOVIE_BY_ID = new Map(DATA.movies.map((m) => [m.movieId, m]));

function movieStatsFor(yearFrom, yearTo) {
  const ratings = filterRatings(yearFrom, yearTo);
  const byMovie = new Map();
  for (const [, movieId, rating] of ratings) {
    if (!byMovie.has(movieId)) byMovie.set(movieId, []);
    byMovie.get(movieId).push(rating);
  }
  const rows = [];
  for (const [movieId, vals] of byMovie.entries()) {
    const movie = MOVIE_BY_ID.get(movieId);
    if (!movie) continue;
    rows.push({
      movieId,
      title: movie.title,
      year: movie.year,
      genres: movie.genres,
      avg_rating: mean(vals),
      rating_count: vals.length,
      rating_std: std(vals),
    });
  }
  return rows;
}

function localApi(path, params = {}) {
  const yf = params.year_from != null ? Number(params.year_from) : null;
  const yt = params.year_to != null ? Number(params.year_to) : null;

  if (path === "/api/meta") {
    const years = DATA.ratings.map((r) => r[3]);
    return {
      year_min: Math.min(...years),
      year_max: Math.max(...years),
      genres: DATA.genres,
      total_movies: DATA.movies.length,
      total_users: new Set(DATA.ratings.map((r) => r[0])).size,
    };
  }

  if (path === "/api/summary") {
    const ratings = filterRatings(yf, yt);
    return {
      total_ratings: ratings.length,
      total_users: new Set(ratings.map((r) => r[0])).size,
      total_movies_rated: new Set(ratings.map((r) => r[1])).size,
      avg_rating: ratings.length ? round3(mean(ratings.map((r) => r[2]))) : null,
    };
  }

  if (path === "/api/rating-distribution") {
    const ratings = filterRatings(yf, yt);
    const bins = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0];
    const counts = bins.map((b) => ratings.filter((r) => r[2] === b).length);
    return { bins, counts };
  }

  if (path === "/api/yearly-volume") {
    const ratings = filterRatings(yf, yt);
    const byYear = new Map();
    for (const [, , , year] of ratings) byYear.set(year, (byYear.get(year) || 0) + 1);
    const years = [...byYear.keys()].sort((a, b) => a - b);
    return { years, counts: years.map((y) => byYear.get(y)) };
  }

  if (path === "/api/agreement") {
    const minRatings = params.min_ratings ?? 50;
    const limit = params.limit ?? 800;
    const rows = movieStatsFor(yf, yt)
      .filter((r) => r.rating_count >= minRatings)
      .sort((a, b) => b.rating_count - a.rating_count)
      .slice(0, limit);
    return { points: rows.map((r) => ({ movieId: r.movieId, title: r.title, year: r.year, avg_rating: round3(r.avg_rating), rating_count: r.rating_count })) };
  }

  if (path === "/api/divisive") {
    const minRatings = params.min_ratings ?? 200;
    const limit = params.limit ?? 15;
    const rows = movieStatsFor(yf, yt)
      .filter((r) => r.rating_count >= minRatings)
      .sort((a, b) => b.rating_std - a.rating_std)
      .slice(0, limit);
    return { rows: rows.map((r) => ({ movieId: r.movieId, title: r.title, avg_rating: round3(r.avg_rating), rating_std: round3(r.rating_std), rating_count: r.rating_count })) };
  }

  if (path === "/api/genres") {
    const ratings = filterRatings(yf, yt);
    const byGenre = new Map();
    for (const [, movieId, rating] of ratings) {
      const movie = MOVIE_BY_ID.get(movieId);
      if (!movie) continue;
      for (const g of movie.genres) {
        if (!byGenre.has(g)) byGenre.set(g, []);
        byGenre.get(g).push(rating);
      }
    }
    const overallMean = mean(ratings.map((r) => r[2]));
    const genreRows = [...byGenre.entries()].map(([genre, vals]) => ({
      genre, avg_rating: mean(vals), count: vals.length,
    }));
    const counts = genreRows.map((r) => r.count).sort((a, b) => a - b);
    const m = counts.length ? counts[Math.floor(counts.length / 2)] : 0;
    const rows = genreRows.map((r) => ({
      genre: r.genre,
      avg_rating: round3(r.avg_rating),
      weighted_rating: round3((r.count / (r.count + m)) * r.avg_rating + (m / (r.count + m)) * overallMean),
      count: r.count,
    })).sort((a, b) => b.count - a.count);
    return { overall_mean: round3(overallMean), rows };
  }

  if (path === "/api/movies/search") {
    const q = (params.q || "").toLowerCase();
    const limit = params.limit ?? 10;
    const globalStats = new Map(movieStatsFor(null, null).map((r) => [r.movieId, r]));
    const results = DATA.movies
      .filter((m) => m.title.toLowerCase().includes(q))
      .map((m) => ({ ...m, rating_count: globalStats.get(m.movieId)?.rating_count || 0 }))
      .sort((a, b) => b.rating_count - a.rating_count)
      .slice(0, limit);
    return { results: results.map((r) => ({ movieId: r.movieId, title: r.title, year: r.year, genres: r.genres, rating_count: r.rating_count })) };
  }

  if (path === "/api/genome/movie") {
    const movieId = Number(params.movieId);
    const topN = params.top_n ?? 15;
    const vec = DATA.genome[String(movieId)];
    const movie = MOVIE_BY_ID.get(movieId);
    if (!vec) return { movieId, title: movie ? movie.title : null, tags: [] };
    const tagged = DATA.genomeTags.map((tag, i) => ({ tag, relevance: vec[i] }));
    tagged.sort((a, b) => b.relevance - a.relevance);
    return { movieId, title: movie ? movie.title : null, tags: tagged.slice(0, topN) };
  }

  if (path === "/api/genome/genre-fingerprint") {
    const genreList = params.genres ? params.genres.split(",").map((s) => s.trim()) : null;
    const topTagsN = params.top_tags ?? 10;

    // average relevance per (genre, tag)
    const sums = new Map(); // key: genre|tagIdx -> {sum,count}
    for (const [movieIdStr, vec] of Object.entries(DATA.genome)) {
      const movie = MOVIE_BY_ID.get(Number(movieIdStr));
      if (!movie) continue;
      for (const g of movie.genres) {
        if (genreList && !genreList.includes(g)) continue;
        for (let i = 0; i < vec.length; i++) {
          const key = g + "|" + i;
          if (!sums.has(key)) sums.set(key, { sum: 0, count: 0 });
          const cell = sums.get(key);
          cell.sum += vec[i];
          cell.count += 1;
        }
      }
    }
    const genresPresent = [...new Set([...sums.keys()].map((k) => k.split("|")[0]))].sort();

    // pick tags with the highest cross-genre variance (same idea as the backend)
    const tagVariance = DATA.genomeTags.map((tag, i) => {
      const vals = genresPresent.map((g) => {
        const cell = sums.get(g + "|" + i);
        return cell ? cell.sum / cell.count : null;
      }).filter((v) => v !== null);
      return { tag, i, variance: std(vals) };
    });
    tagVariance.sort((a, b) => b.variance - a.variance);
    const chosen = tagVariance.slice(0, topTagsN);

    const matrix = genresPresent.map((g) =>
      chosen.map(({ i }) => {
        const cell = sums.get(g + "|" + i);
        return cell ? round3(cell.sum / cell.count) : null;
      })
    );

    return { genres: genresPresent, tags: chosen.map((c) => c.tag), matrix };
  }

  throw new Error(`Unknown mock endpoint: ${path}`);
}

function round3(n) { return Math.round(n * 1000) / 1000; }
