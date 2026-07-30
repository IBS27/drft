import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// The product's heartbeat. Every 15 minutes, resurfacing.tick checks each
// user's wall clock against their chosen time — delivery lands within a
// quarter hour of "8:30, with coffee", whatever the timezone, and a
// missed tick (deploy, outage) is caught by the next one.
const crons = cronJobs();
crons.interval("daily thought", { minutes: 15 }, internal.resurfacing.tick);
export default crons;
