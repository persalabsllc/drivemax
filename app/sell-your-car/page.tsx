import { pageMetadata } from "../../lib/seo";
import { CarFront, ClipboardList, Handshake } from "lucide-react";
import { backendReady } from "../../lib/backend";
import SellVehicleForm from "../_components/SellVehicleForm";

export const metadata = pageMetadata({
  title: "Sell Your Car in New Bern",
  description:
    "Sell your car, truck, or SUV to Drive Max Used Cars in New Bern, NC. Share your VIN, mileage, and condition to request a purchase offer from our team.",
  path: "/sell-your-car",
});
export default function SellYourCarPage() {
  return (
    <>
      <section className="subpage-hero sell-hero">
        <div className="container">
          <span className="kicker kicker-on-dark">Sell to Drive Max</span>
          <h1>Your next move starts with an offer.</h1>
          <p>
            Ready to sell your car, truck, or SUV? Tell us about it. We’ll
            review the details and follow up with a purchase offer or the next
            steps.
          </p>
          <a className="button button-primary" href="#purchase-offer">
            Tell us about your vehicle
          </a>
        </div>
      </section>
      <section className="page-section page-section-muted" id="purchase-offer">
        <div className="container content-split sell-layout">
          <div className="content-intro">
            <span className="kicker">A straightforward sale</span>
            <h2>From your driveway to our lot.</h2>
            <p>
              Start online, talk with our team, and decide what works for you.
            </p>
            <div className="sell-process">
              <div>
                <CarFront aria-hidden="true" />
                <h3>Tell us what you drive</h3>
                <p>
                  Share the VIN, mileage, condition, and anything that makes
                  your vehicle stand out.
                </p>
              </div>
              <div>
                <ClipboardList aria-hidden="true" />
                <h3>Let’s talk numbers</h3>
                <p>
                  Our team reviews your request and follows up using your
                  preferred contact method.
                </p>
              </div>
              <div>
                <Handshake aria-hidden="true" />
                <h3>Make it happen</h3>
                <p>
                  If the offer works for you, we’ll arrange a vehicle inspection
                  and work through the paperwork.
                </p>
              </div>
            </div>
            <p className="sell-location">
              Drive Max Used Cars
              <br />
              6210 Old US Hwy 70 West
              <br />
              New Bern, NC 28562
            </p>
          </div>
          <SellVehicleForm
            online={backendReady() && !!process.env.LEAD_RATE_LIMIT_SECRET}
          />
        </div>
      </section>
    </>
  );
}
