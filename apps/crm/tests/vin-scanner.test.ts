import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import fixtures from "./fixtures/vin-barcodes.json";
import {
  cameraErrorMessage,
  vinFromBarcode,
  vinReadTracker,
} from "../lib/vin-scan";
import {
  createBarcodeDecoder,
  startVinCamera,
  readVinPhoto,
} from "../lib/vin-camera";

const vin = "1HGCM82633A004352";
function barcodeCanvas(fixture = fixtures.fixtures[0], turned = false) {
  const width = fixture.width,
    height = fixture.height;
  const rgba = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [x, size] of fixture.bars)
    for (let y = 20; y < height - 20; y++)
      for (let dx = 0; dx < size; dx++) {
        const offset = (y * width + x + dx) * 4;
        rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = 0;
      }
  if (!turned)
    return {
      width,
      height,
      getContext: () => ({ getImageData: () => ({ data: rgba }) }),
    } as unknown as HTMLCanvasElement;
  const rotated = new Uint8ClampedArray(rgba.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      rotated.set(
        rgba.subarray((y * width + x) * 4, (y * width + x + 1) * 4),
        (x * height + height - y - 1) * 4,
      );
  return {
    width: height,
    height: width,
    getContext: () => ({ getImageData: () => ({ data: rotated }) }),
  } as unknown as HTMLCanvasElement;
}

test("VIN payloads require a complete unambiguous VIN; label wrappers are supported", () => {
  for (const raw of [
    vin,
    vin.toLowerCase(),
    ` VIN: ${vin}\r\n`,
    `*${vin}*`,
    `I${vin}`,
    `]A0I${vin}`,
  ])
    assert.equal(vinFromBarcode(raw), vin);
  for (const raw of [
    "",
    vin.slice(0, -1),
    `1${vin}`,
    `${vin}1`,
    `${vin};1M8GDM9AXKP042788`,
    "PART-123456789",
    vin.replace("H", "I"),
    `https://example.invalid/${vin}`,
    JSON.stringify({ vin }),
    "X".repeat(101),
  ])
    assert.equal(vinFromBarcode(raw), null, raw);
});
test("camera confirmation needs two matching reads within two seconds", () => {
  const read = vinReadTracker();
  assert.equal(read(vin, 0), null);
  assert.equal(read(null, 100), null);
  assert.equal(read(vin, 250), vin);
  assert.equal(read(vin, 3000), null);
  assert.equal(read("1M8GDM9AXKP042788", 3200), null);
  assert.equal(read(vin, 3300), null);
});
test("real Code 39 and Code 128 pixels decode without the native BarcodeDetector API", async () => {
  const decode = await createBarcodeDecoder();
  for (const f of fixtures.fixtures) {
    const raw = decode(barcodeCanvas(f));
    assert.equal(raw, f.text, f.name);
    assert.equal(vinFromBarcode(raw!), f.name === "code128_parts" ? null : vin);
  }
  assert.equal(
    decode(barcodeCanvas(fixtures.fixtures[0], true), true),
    vin,
    "Vertical labels also decode",
  );
  const blank = { ...fixtures.fixtures[0], width: 120, height: 80, bars: [] };
  assert.equal(
    decode(barcodeCanvas(blank), true),
    null,
    "A normal empty frame must not crash scanning",
  );
});

function cameraFixture(t: TestContext) {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator"),
    oldDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  class Track extends EventTarget {
    stops = 0;
    constraints: unknown[] = [];
    stop() {
      this.stops++;
    }
    getCapabilities() {
      return { torch: true };
    }
    async applyConstraints(value: unknown) {
      this.constraints.push(value);
    }
  }
  const track = new Track(),
    stream = {
      getTracks: () => [track],
      getVideoTracks: () => [track],
    } as unknown as MediaStream;
  const requests: MediaStreamConstraints[] = [];
  const devices = {
    getUserMedia: async (value: MediaStreamConstraints) => {
      requests.push(value);
      return stream;
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: devices },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage() {} }),
      }),
    },
  });
  const video = {
    srcObject: null,
    muted: false,
    playsInline: false,
    readyState: 4,
    videoWidth: 1280,
    videoHeight: 720,
    play: async () => {},
    pause: () => {},
  } as unknown as HTMLVideoElement;
  const controller = new AbortController();
  t.after(() => {
    controller.abort();
    if (oldNavigator)
      Object.defineProperty(globalThis, "navigator", oldNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (oldDocument) Object.defineProperty(globalThis, "document", oldDocument);
    else Reflect.deleteProperty(globalThis, "document");
  });
  return { track, stream, requests, devices, video, controller };
}
test(
  "live scanning prefers the rear camera, requests no microphone, confirms once and releases tracks",
  { timeout: 3000 },
  async (t) => {
    const f = cameraFixture(t);
    let scans = 0,
      results = 0;
    const found = new Promise<string>((resolve, reject) => {
      void startVinCamera({
        video: f.video,
        signal: f.controller.signal,
        decoder: async () => () => {
          scans++;
          return vin;
        },
        onVin: (value) => {
          results++;
          resolve(value);
        },
        onHint: () => {},
        onError: reject,
      })
        .then(async (controls) => {
          await controls.setTorch?.(true);
          assert.deepEqual(f.track.constraints, [
            { advanced: [{ torch: true }] },
          ]);
        })
        .catch(reject);
    });
    assert.equal(await found, vin);
    assert.equal(results, 1);
    assert.equal(scans, 2);
    assert.equal(f.requests[0].audio, false);
    assert.deepEqual(
      (f.requests[0].video as MediaTrackConstraints).facingMode,
      { ideal: "environment" },
    );
    assert(f.track.stops > 0);
    assert.equal(f.video.srcObject, null);
  },
);
test("closing before camera permission resolves stops the late stream without attaching it", async (t) => {
  const f = cameraFixture(t);
  let grant!: (stream: MediaStream) => void;
  f.devices.getUserMedia = () =>
    new Promise((resolve) => {
      grant = resolve;
    });
  const opening = startVinCamera({
    video: f.video,
    signal: f.controller.signal,
    decoder: async () => () => vin,
    onVin: () => assert.fail("Closed scanner returned a VIN"),
    onHint: () => {},
    onError: () => assert.fail("Closed scanner returned an error"),
  });
  f.controller.abort();
  grant(f.stream);
  await opening;
  assert.equal(f.track.stops, 1);
  assert.equal(f.video.srcObject, null);
});
test("closing while the decoder loads releases the camera immediately", async (t) => {
  const f = cameraFixture(t);
  let loaded!: (decode: () => null) => void;
  const opening = startVinCamera({
    video: f.video,
    signal: f.controller.signal,
    decoder: () =>
      new Promise((resolve) => {
        loaded = resolve;
      }),
    onVin: () => assert.fail(),
    onHint: () => {},
    onError: () => assert.fail(),
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(f.video.srcObject, f.stream);
  f.controller.abort();
  assert(f.track.stops > 0);
  assert.equal(f.video.srcObject, null);
  loaded(() => null);
  await opening;
});
test("permission and playback failures are recoverable and never leave a camera running", async (t) => {
  const f = cameraFixture(t),
    options = {
      video: f.video,
      signal: f.controller.signal,
      decoder: async () => () => null,
      onVin: () => {},
      onHint: () => {},
      onError: () => {},
    };
  f.devices.getUserMedia = async () => {
    throw new DOMException("Denied", "NotAllowedError");
  };
  await assert.rejects(startVinCamera(options), { name: "NotAllowedError" });
  assert.match(
    cameraErrorMessage(new DOMException("Denied", "NotAllowedError")),
    /browser settings/,
  );
  f.devices.getUserMedia = async () => f.stream;
  f.video.play = async () => {
    throw new Error("Playback failed");
  };
  await assert.rejects(startVinCamera(options), /Playback failed/);
  assert(f.track.stops > 0);
  assert.equal(f.video.srcObject, null);
});
test("photo scanning rejects unsupported and oversized files before decoding", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(
    readVinPhoto(
      new File(["not a photo"], "vin.txt", { type: "text/plain" }),
      signal,
    ),
    /Choose a photo/,
  );
  await assert.rejects(
    readVinPhoto(
      { type: "image/jpeg", size: 21 * 1024 * 1024 } as File,
      signal,
    ),
    /20 MB/,
  );
  const stopped = new AbortController();
  stopped.abort();
  assert.equal(
    await readVinPhoto(
      new File([], "vin.jpg", { type: "image/jpeg" }),
      stopped.signal,
    ),
    null,
  );
});

test("canceling a photo load settles the operation and revokes its object URL", async (t) => {
  const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image");
  Object.defineProperty(globalThis, "Image", {
    configurable: true,
    value: class {
      onload = null;
      onerror = null;
      set src(_value: string) {}
    },
  });
  t.after(() => {
    if (originalImage)
      Object.defineProperty(globalThis, "Image", originalImage);
    else Reflect.deleteProperty(globalThis, "Image");
  });
  t.mock.method(URL, "createObjectURL", () => "blob:vin-photo-test");
  const revoke = t.mock.method(URL, "revokeObjectURL", () => {});
  const controller = new AbortController();
  const reading = readVinPhoto(
    new File(["photo"], "vin.jpg", { type: "image/jpeg" }),
    controller.signal,
  );
  controller.abort();
  await assert.rejects(reading, { name: "AbortError" });
  assert.equal(revoke.mock.callCount(), 1);
  assert.deepEqual(revoke.mock.calls[0].arguments, ["blob:vin-photo-test"]);
});
