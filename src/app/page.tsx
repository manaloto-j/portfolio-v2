"use client";

import ThreeDParallax from "@/app/shared/motion/3DParallax/index";
import profileParallax from "@/assets/images/profileImg/profile-parallax";
import HoverParallax from "./shared/motion/HoverParallax/HoverParallax";
import NavBar from "./shared/navigation/NavBar";
import { useIdleAnimation } from "./shared/motion/FluidCursor/useIdleAnimation";
import ShaderBackground from "./shared/Background";
import FluidCursor from "./shared/motion/FluidCursor/FluidCursor";

export default function Home() {
  useIdleAnimation();

  return (
    <div>
      <NavBar />
      <section
        className="relative overflow-hidden h-screen w-screen"
        data-gridcursor-idle
        data-halftone-idle
      >
        <HoverParallax>
          {/* Image Wrapper */}
          <div className="h-screen w-full">
            <ThreeDParallax
              image={profileParallax}
              className="relative h-full mt-8 w-auto mx-auto z-2"
              data-parallax-hover
              data-parallax-hover-x="-0.02"
              data-parallax-hover-y="0.03"
              data-parallax-hover-idle
              data-3d-idle
            />
          </div>
        </HoverParallax>
        {/* <ShaderBackground
          color="#111111"
          background="#FAFAFA"
          density={0.8}
          noiseAmount={1}
          hover={true}
        /> */}

        <FluidCursor />
      </section>
    </div>
  );
}
