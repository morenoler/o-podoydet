import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decideAdmission } from "../shared/domain/admissionPolicy";
import { rankHotels } from "../shared/matching";
import { tripSchema } from "../shared/validation";
import type { Fact, Hotel, MatchStatus, RoomMatch, Trip } from "../shared/types";

const now = new Date("2026-10-25T12:00:00Z");
const trip: Trip = {region:"Пусан", checkIn:"2026-11-07", checkOut:"2026-11-08", adults:2, children:1, scenarios:[], preferences:[], text:""};
const cases = JSON.parse(readFileSync(new URL("./fixtures/admission-cases.json", import.meta.url), "utf8"));
test("shared TS/Java admission fixtures preserve raw evidence and legacy default", () => {
  for (const fixture of cases) for (const admissionMode of [undefined, "verified", "explore"] as const) {
    const capacity = {capacityStatus: fixture.capacity === "match" ? "match" : "mismatch",
      capacityEvidenceStatus: fixture.capacity} as Pick<RoomMatch,"capacityStatus"|"capacityEvidenceStatus">;
    const criteria = [{required:fixture.required, status:fixture.criterion === "match" ? "match" : "mismatch",
      evidenceStatus:fixture.criterion as MatchStatus}] as Parameters<typeof decideAdmission>[1];
    const before = structuredClone({capacity, criteria});
    const result = decideAdmission(capacity, criteria, {...trip, admissionMode});
    assert.equal(result.status, admissionMode === "explore" ? fixture.explore : fixture.verified, fixture.name);
    assert.equal(result.provisional, admissionMode === "explore" && fixture.provisional, fixture.name);
    assert.deepEqual({capacity, criteria}, before);
  }
});

const source = {sourceUrl:"https://example.test/room", obtainedAt:"2026-10-24T12:00:00Z",quote:"Synthetic official-shaped room"};
function hotel(id: string, capacity: number | null): Hotel {
  return {id,name:id,address:"",coordinates:null,osmUrl:"",route:null,noise:[],rooms:[
    {id:id+"-room",name:id,capacity,demo:false,evidenceStatus:"verified",...source}]};
}
function fact(id: string, value: boolean, extra: Partial<Fact> = {}): Fact {
  return {id:id+"-fact",hotelId:id,roomId:id+"-room",feature:"family",value,source:"Fixture",method:"official",
    confidence:"high",confidenceReason:"Fixture",expiresAt:"2026-12-01T00:00:00Z",demo:false,...source,...extra};
}
test("ranking keeps rooms scoped and puts confirmed admission ahead of a higher scoring provisional room", () => {
  const hotels = [hotel("unknown",null),hotel("negative",4),hotel("conflict",4),hotel("stale",4),hotel("yes",4)];
  const facts = [fact("negative",false),fact("conflict",true),fact("conflict",false,{id:"second"}),
    fact("stale",true,{expiresAt:"2026-10-24T00:00:00Z"}),fact("yes",true)];
  const preferences = [{feature:"family" as const, required:true}];
  const explore = rankHotels(hotels,facts,preferences,{...trip,admissionMode:"explore"},now);
  assert.equal(explore[0].hotel.id,"yes");
  for (const item of explore) {
    assert.equal(item.best.room.id,item.hotel.id+"-room");
    if (["unknown","stale"].includes(item.hotel.id)) {
      assert.equal(item.best.status,"fits"); assert.equal(item.best.provisional,true);
      assert.equal(item.best.criteria[0].status,"mismatch");
    } else if (item.hotel.id !== "yes") assert.equal(item.best.status,"excluded");
  }
  assert.deepEqual(rankHotels(hotels,facts,preferences,trip,now).filter(h=>h.best.status==="fits").map(h=>h.hotel.id),["yes"]);
  const highScore = rankHotels([hotel("unknown",null),hotel("yes",4)], [fact("unknown",true)],
    [{feature:"family",required:false}], {...trip,admissionMode:"explore"},now);
  assert.equal(highScore[0].hotel.id,"yes");
});

test("mode validation accepts only explicit supported values and preserves legacy omission", () => {
  assert.equal(tripSchema.parse(trip).admissionMode,undefined);
  for (const mode of ["explore","verified"]) assert.equal(tripSchema.parse({...trip,admissionMode:mode}).admissionMode,mode);
  for (const mode of [null,"relaxed",true,1]) assert.equal(tripSchema.safeParse({...trip,admissionMode:mode}).success,false);
});
