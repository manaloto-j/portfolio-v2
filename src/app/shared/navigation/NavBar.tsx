"use client";

import Link from "next/link";
import { Logo } from "@/assets/svgs/index";

export default function NavBar() {
  const navLink = "text-white-100 text-18 font-satoshi";

  return (
    <nav
      className="fixed py-24 left-0 w-full px-12 flex items-center justify-between z-50"
      data-halftone-ignore
    >
      <div
        className={`${navLink} leading-[80%] text-center text-[24px] text-bg`}
      >
        <p>
          <b>JOHNZELLE</b>
        </p>
        <p>
          <i>MANALOTO</i>
        </p>
      </div>

      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center text-bg">
        <Logo className="w-8 h-8 shrink-0" />
      </div>

      <ul className="flex gap-12 items-center">
        <li>
          <Link className={`${navLink} text-bg`} href="/">
            Home
          </Link>
        </li>
        <li>
          <Link className={`${navLink} text-bg`} href="/about">
            About
          </Link>
        </li>
        <li>
          <Link className={`${navLink} text-bg`} href="/works">
            Works
          </Link>
        </li>
        <li>
          <Link className={`${navLink} text-bg`} href="/contact">
            Contact
          </Link>
        </li>
      </ul>
    </nav>
  );
}
