"""
Builds js/data.js — a static, embedded JS data bundle sourced from your
REAL MovieLens CSVs (not synthetic mock data), sized to load quickly in a
browser on GitHub Pages, which has no backend at all.

Usage:
    pip install pandas
    python build_static_data.py /path/to/your/real/data

The argument is the folder containing movies.csv, ratings.csv,
genome-scores.csv, genome-tags.csv (defaults to "../movielens-dashboard/data"
if you don't pass one).
"""

import json
import os
import re
import sys

import pandas as pd

SRC = sys.argv[1] if len(sys.argv) > 1 else "../movielens-dashboard/data"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "js", "data.js")

# Tuned for a fast page load: this file gets downloaded by every visitor's
# browser (unlike a backend, which loads data once into server RAM), so it
# needs to be much smaller than what a Render deployment could get away
# with. These defaults land the bundle around 3-7MB uncompressed, a couple
# MB gzipped — fine for a one-time dashboard load.
RATINGS_SAMPLE_SIZE = 120_000
TOP_MOVIES_FOR_GENOME = 300

YEAR_RE = re.compile(r"\((\d{4})\)\s*$")


def main():
    print(f"Reading real data from: {SRC}")
    movies = pd.read_csv(os.path.join(SRC, "movies.csv"))
    ratings = pd.read_csv(os.path.join(SRC, "ratings.csv"))

    movies["year"] = movies["title"].str.extract(YEAR_RE)
    movies["year"] = pd.to_numeric(movies["year"], errors="coerce")
    movies["genre_list"] = movies["genres"].fillna("").apply(
        lambda g: [] if g in ("", "(no genres listed)") else g.split("|")
    )

    movies_out = [
        {
            "movieId": int(r.movieId),
            "title": r.title,
            "year": None if pd.isna(r.year) else int(r.year),
            "genres": r.genre_list,
        }
        for r in movies.itertuples()
    ]

    print(f"Sampling ratings: {len(ratings):,} -> {min(RATINGS_SAMPLE_SIZE, len(ratings)):,} rows")
    ratings_sample = ratings.sample(n=min(RATINGS_SAMPLE_SIZE, len(ratings)), random_state=42)
    ratings_sample["year"] = pd.to_datetime(ratings_sample["timestamp"], unit="s").dt.year
    ratings_out = ratings_sample[["userId", "movieId", "rating", "year"]].values.tolist()
    ratings_out = [[int(u), int(m), float(r), int(y)] for u, m, r, y in ratings_out]

    genome_scores_path = os.path.join(SRC, "genome-scores.csv")
    genome_tags_path = os.path.join(SRC, "genome-tags.csv")
    genome_out = {}
    genome_tags_out = []
    if os.path.exists(genome_scores_path) and os.path.exists(genome_tags_path):
        print("Building genome bundle for the most-rated movies...")
        genome_scores = pd.read_csv(genome_scores_path)
        genome_tags = pd.read_csv(genome_tags_path).sort_values("tagId")
        genome_tags_out = genome_tags["tag"].tolist()
        tag_order = genome_tags["tagId"].tolist()
        tag_index = {t: i for i, t in enumerate(tag_order)}

        top_movies = ratings["movieId"].value_counts().head(TOP_MOVIES_FOR_GENOME).index
        subset = genome_scores[genome_scores["movieId"].isin(top_movies)]
        for movie_id, group in subset.groupby("movieId"):
            vec = [0.0] * len(tag_order)
            for r in group.itertuples():
                if r.tagId in tag_index:
                    vec[tag_index[r.tagId]] = round(float(r.relevance), 4)
            genome_out[str(int(movie_id))] = vec
        print(f"Genome data for {len(genome_out)} movies x {len(genome_tags_out)} tags")
    else:
        print("No genome files found — genome pages will show no data (handled gracefully).")

    all_genres = sorted({g for row in movies["genre_list"] for g in row})

    data = {
        "movies": movies_out,
        "ratings": ratings_out,
        "genomeTags": genome_tags_out,
        "genome": genome_out,
        "genres": all_genres,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        f.write("// Static data bundle, sampled from the real MovieLens dataset.\n")
        f.write("const DATA = " + json.dumps(data, separators=(",", ":")) + ";\n")

    size_mb = os.path.getsize(OUT) / 1e6
    print(f"\nWrote {OUT} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
