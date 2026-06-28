import Link from "next/link";
import { Logo } from "@/assets/svgs/index";

export default function NavBar() {
  const navLink = "text-white-100 text-18 font-satoshi";
  return (
    <div>
      <Logo />
      <ul className="flex gap-12">
        <Link className={navLink} href="/.">
          Home
        </Link>
        <Link className={navLink} href="/about">
          About
        </Link>
        <Link className={navLink} href="/works">
          Works
        </Link>
        <Link className={navLink} href="/contact">
          Contact
        </Link>
      </ul>
    </div>
  );
}
