import { Facebook, Instagram } from "lucide-react";

const profiles = [
  { name: "Facebook", href: "https://www.facebook.com/drivemaxnc/", Icon: Facebook },
  { name: "Instagram", href: "https://www.instagram.com/drivemaxnc/", Icon: Instagram },
] as const;

export default function SocialLinks() {
  return (
    <nav className="social-links" aria-label="Follow Drive Max on social media">
      {profiles.map(({ name, href, Icon }) => (
        <a
          key={name}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${name} (opens in a new tab)`}
        >
          <Icon aria-hidden="true" size={17} />
          {name}
        </a>
      ))}
    </nav>
  );
}
