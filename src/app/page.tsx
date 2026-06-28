import ThreeDParallax from "@/app/shared/motion/3DParallax/index";
import profileParallax from "@/assets/images/profileImg/profile-parallax";
import toothParallax from "@/assets/images/depthTest/tooth-parallax";
import HoverParallax from "./shared/motion/HoverParallax/HoverParallax";
import NavBar from "./shared/navigation/NavBar";

export default function Home() {
  return (
    <div>
      <NavBar />
      <section
        className="relative overflow-hidden h-screen w-screen"
        data-gridcursor-idle
      >
        <HoverParallax>
          {/* Image Wrapper */}
          <div className="h-screen w-full">
            <ThreeDParallax
              image={profileParallax}
              className="relative h-full w-auto mx-auto z-2"
              data-parallax-hover
              data-parallax-hover-x="-0.02"
              data-parallax-hover-y="0.03"
              data-parallax-hover-idle
              data-3d-idle
            />
          </div>
        </HoverParallax>
      </section>
    </div>
  );
}
