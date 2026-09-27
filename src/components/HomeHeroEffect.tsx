"use client";

import { useEffect } from "react";

export default function HomeHeroEffect() {
  useEffect(() => {
    const hero = document.getElementById("home-hero");
    if (!hero) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        document.body.classList.toggle("hero-active", entry.isIntersecting);
      },
      { threshold: 0 },
    );

    observer.observe(hero);

    return () => {
      observer.disconnect();
      document.body.classList.remove("hero-active");
    };
  }, []);

  return null;
}
