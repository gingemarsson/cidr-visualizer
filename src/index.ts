import { ZCurve } from "@thi.ng/morton/zcurve";
declare var BigInt: (_: number | string | bigint) => bigint; // Hack to support BigInt in Typescript

const MAX_IP = BigInt(4294967296); // 255.255.255.255 (2^32);
const MIN_IP = BigInt(0); // 0.0.0.0;
const PIXEL_SIZE = BigInt(4096); // Number of ips per pixel
const DIVIDE_SIZE = BigInt(16); // When drawing recursivly, how many areas should the image be split into
const COLORS = [
    { r: 255, g: 115, b: 67 },
    { r: 198, g: 77, b: 136 },
    { r: 246, g: 93, b: 95 },
    { r: 84, g: 79, b: 139 },
    { r: 227, g: 80, b: 118 },
    { r: 124, g: 80, b: 147 },
    { r: 163, g: 78, b: 146 },
];

const z = new ZCurve(2, 20);

class InputHandler {
    constructor() {
        let inputElement = document.getElementById("start-button") as HTMLTextAreaElement;
        inputElement.addEventListener('click', InputHandler.doWork)
        InputHandler.showResult();
    }

    static doWork() {
        if (ProgressTracker.isDrawing) {
            return;
        }

        InputHandler.showResult();
    }

    private static showResult() {
        const cidrRanges = ((document.getElementById("cidr") as HTMLTextAreaElement).value as any)
            .replaceAll(',', '\n')
            .split('\n')
            .filter((l: any) => !!l)
            .filter((l: string) => InputHandler.lineIsValidCIDR(l))
            .map((l: string) => l.trim())
            .map((l: string) => CidrRange.parseString(l))
            .map((range: CidrRange, index: number) => new CidrRangeWithColor(range.startIp, range.netmask, COLORS[index % COLORS.length]));

        InputHandler.draw(cidrRanges)
    }

    private static lineIsValidCIDR(line: string) {
        let regexp = /(\d{1,3})(\.(\d{1,3})){3}\/\d{1,2}/;
        return regexp.test(line);
    }

    private static ipToPixel(ip: IpAddress) {
        return {
            x: z.decode(ip.ip / BigInt(4096))[0],
            y: z.decode(ip.ip / BigInt(4096))[1]
        }
    }

    private static draw(cidrRanges: CidrRangeWithColor[]) {
        if (cidrRanges.length == 0) {
            return;
        }

        let progress = new ProgressTracker(MAX_IP);
        progress.start();

        let visualizer = new Vizualizer();
        visualizer.clear();

        this.recursiveDraw(MIN_IP, MAX_IP, MAX_IP, cidrRanges, visualizer, progress);
    }

    private static recursiveDrawAsync(start: bigint, stop: bigint, groupSize: bigint, cidrRanges: CidrRangeWithColor[], visualizer: Vizualizer, progressTracker: ProgressTracker) {
        setTimeout(() => {
            InputHandler.recursiveDraw(start, stop, groupSize, cidrRanges, visualizer, progressTracker);
        }, 0);
    }

    private static recursiveDraw(start: bigint, stop: bigint, groupSize: bigint, cidrRanges: CidrRangeWithColor[], visualizer: Vizualizer, progressTracker: ProgressTracker) {
        let cidr = new CidrRange(new IpAddress(), 0); // Reuse the same cidr object since it improves performance, and all runs on a single thread anyway.

        for (var i = start; i < stop; i += groupSize) {
            cidr.startIp.ip = i;
            cidr.netmask = Math.log2(Number(MAX_IP) / Number(groupSize));

            let hit = false;

            for (let j = 0; j < cidrRanges.length; j++) {
                if (cidr.overlaps(cidrRanges[j])) {
                    hit = true;
                    if (groupSize <= PIXEL_SIZE) { // We are looking at individual pixels -> Draw
                        visualizer.drawPixel(cidrRanges[j].color, InputHandler.ipToPixel(cidr.startIp));
                        progressTracker.done(groupSize);
                    }
                    else { // We are looking at a group of pixels -> Subdivide
                        InputHandler.recursiveDrawAsync(i, i + groupSize, groupSize / DIVIDE_SIZE, cidrRanges, visualizer, progressTracker)
                    }
                    break;
                }
            }

            // If there were no overlaps, this entire span is ok and needs no further action.
            if (!hit) {
                progressTracker.done(groupSize);
            }
        }
    }

}

class ProgressTracker {
    count: bigint;
    total: bigint;
    startTime: number | null;
    progressBarElement: HTMLDivElement | null = null;
    startButtonElement: HTMLButtonElement | null = null;

    static isDrawing: boolean = false;

    constructor(total: bigint) {
        this.count = BigInt(0);
        this.total = total;
        this.startTime = null;

        this.progressBarElement = document.getElementById("progress-bar") as HTMLDivElement;
        this.startButtonElement = document.getElementById("start-button") as HTMLButtonElement;
    }

    public start() {
        this.startTime = Date.now();
        ProgressTracker.isDrawing = true;

        if (this.progressBarElement) {
            this.progressBarElement.style.opacity = '1';
            this.progressBarElement.style.width = '0';
        }
        if (this.startButtonElement) {
            this.startButtonElement.disabled = true;
        }
    }

    public getPercent() {
        return (Number(this.count) / Number(this.total)) * 100;
    }

    public done(count: bigint) {
        var previousCount = this.count;

        this.count += count;

        // Progress
        if ((this.count / (MAX_IP / BigInt(10))) != (previousCount / (MAX_IP / BigInt(10)))) { // Print every 10 percent
            console.log(Math.floor(this.getPercent()) + "%");
        }
        if ((this.count / (MAX_IP / BigInt(100))) != (previousCount / (MAX_IP / BigInt(100))) && this.progressBarElement) { // Update progressbar every percent
            this.progressBarElement.style.width = this.getPercent() + "%";
        }

        // Done
        if (this.count == this.total) {
            ProgressTracker.isDrawing = false;

            let timeElapsed = this.startTime ? (Date.now() - this.startTime) / 1000 : 'n/a ';
            console.log("Drawing completed! (" + timeElapsed + "s)");

            if (this.progressBarElement) {
                const progressBarElement = this.progressBarElement;

                progressBarElement.style.opacity = '0';
                setTimeout(() => progressBarElement.style.width = '0', 1000);
            }

            if (this.startButtonElement) {
                this.startButtonElement.disabled = false;
            }
        }
    }
}

class Vizualizer {
    visualizerCanvas: HTMLCanvasElement | null = null;
    ctx: CanvasRenderingContext2D | null = null;

    constructor() {
        this.visualizerCanvas = document.getElementById("visualizer") as HTMLCanvasElement;
        if (this.visualizerCanvas) {
            this.ctx = this.visualizerCanvas.getContext('2d');
        }
    }

    public drawPixel(rgb: { r: number, b: number, g: number }, pos: { x: number, y: number }) {
        if (this.ctx) {
            this.ctx.fillStyle = "rgba(" + rgb.r + "," + rgb.g + "," + rgb.b + ", 1)";
            this.ctx.fillRect(pos.x, pos.y, 1, 1);
        }
    }

    public clear() {
        if (this.ctx) {
            this.ctx.clearRect(0, 0, 1024, 1024);
        }
    }
}

class IpAddress {
    ip: bigint;

    constructor(array?: bigint[]) {
        if (array === null || array === undefined || array.length != 4) {
            this.ip = BigInt(0);
            return;
        }

        this.ip = array[0] * BigInt(16777216) + array[1] * BigInt(65536) + array[2] * BigInt(256) + array[3];
    }

    public toArray() {
        let ip = new Array(4) as bigint[];

        ip[3] = this.ip % BigInt(256);
        ip[2] = this.ip / BigInt(256) % BigInt(256);
        ip[1] = this.ip / BigInt(65536) % BigInt(256);
        ip[0] = this.ip / BigInt(16777216) % BigInt(256);

        return ip;
    }

    public toString() {
        return this.toArray().join('.')
    }

    public isLessThan(other: IpAddress) {
        return this.ip < other.ip;
    }

    public isEqualTo(other: IpAddress) {
        return this.ip === other.ip;
    }

    public isLargerThan(other: IpAddress) {
        return this.ip > other.ip;
    }

    public add(modifier: bigint) {
        if (this.ip + modifier > MAX_IP) {
            throw ("IP out of bounds error (to large)");
        }

        if (this.ip + modifier < MIN_IP) {
            throw ("IP out of bounds error (to small)");

        }

        return IpAddress.getIpFromInt(this.ip + modifier)
    }

    public copy() {
        return IpAddress.getIpFromInt(this.ip);
    }

    public static getIpFromInt(ip: bigint) {
        let copy = new IpAddress();
        copy.ip = ip;
        return copy;
    }

}

class CidrRange {
    startIp: IpAddress;
    netmask: number;

    constructor(ip: IpAddress, netmask: number) {
        this.startIp = ip;
        this.netmask = netmask;
    }

    public start() {
        return this.startIp.copy();
    }

    public end() {
        return this.startIp.add(BigInt(Math.pow(2, 32 - this.netmask) - 1));
    }

    public overlaps(other: CidrRange) {
        const a = this;
        const b = other;

        if (a.end().isLessThan(b.start()) || b.end().isLessThan(a.start()))
            return false;

        return true;
    }

    public toString() {
        return this.startIp.toString() + "/" + this.netmask;
    }

    public static parseString(s: string) {
        let [ipString, netmaskString] = s.split('/');
        let ip = ipString.split('.').map(x => BigInt(x));
        let netmask = parseInt(netmaskString);

        return new CidrRange(new IpAddress(ip), netmask);
    }
}

class CidrRangeWithColor extends CidrRange {
    color: { r: number; b: number; g: number; };

    constructor(ip: IpAddress, netmask: number, color: { r: number, b: number, g: number }) {
        super(ip, netmask);
        this.color = color;
    }
}

new InputHandler(); // Start app