import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { listingMapCenter, regionNames } from "../shared/regions";
import { cameraBasis, dragGlobe, globeGeometry, interpolateCamera, isGlobeClick, pickGlobePoint, projectPoint, wrapLongitude } from "../src/features/globe/globeMath";

const geometry=globeGeometry(1000,800,.5,.5,.45);
function near(actual:number,expected:number,tolerance=1e-8) { assert.ok(Math.abs(actual-expected)<tolerance,`${actual} != ${expected}`); }

test("the globe and atmosphere stay inside desktop, mobile and off-centre viewports",()=>{
  for (const [width,height] of [[733,750],[375,420],[960,480],[420,900],[1800,1000]]) {
    for (const [x,y,r] of [[.5,.5,.46],[.64,.56,.56],[.2,.8,1]]) {
      const frame=globeGeometry(width,height,x,y,r);
      assert.ok(frame.radius>0);
      assert.ok(frame.centerX-frame.radius>=16);
      assert.ok(frame.centerX+frame.radius<=width-16);
      assert.ok(frame.centerY-frame.radius>=16);
      assert.ok(frame.centerY+frame.radius<=height-16);
    }
  }
  assert.equal(globeGeometry(0,0).radius,0);
  assert.equal(globeGeometry(NaN,-10).radius,0);
});

test("supported region coordinates explicitly map longitude/latitude to an orthographic globe",()=>{
  for(const region of regionNames) {
    const [longitude,latitude]=listingMapCenter(region), camera={longitude,latitude};
    const projected=projectPoint(camera,camera,geometry);
    near(projected.x,geometry.centerX); near(projected.y,geometry.centerY); near(projected.depth,1);
    assert.equal(projected.visible,true);
    const picked=pickGlobePoint(projected.x,projected.y,camera,geometry)!;
    near(picked.longitude,longitude);near(picked.latitude,latitude);
  }
});
test("visible geographic points round-trip under tilted cameras across the date line",()=>{
  let checked=0;
  for(const latitude of [-70,-20,0,35,75]) for(const longitude of [-179,-100,-1,40,129,179]) {
    const camera={latitude:latitude/2,longitude:wrapLongitude(longitude+23)};
    const point={latitude,longitude}, projected=projectPoint(point,camera,geometry);
    assert.equal(projected.visible,true);
    const picked=pickGlobePoint(projected.x,projected.y,camera,geometry)!;
    near(picked.latitude,latitude);near(wrapLongitude(picked.longitude-longitude),0);checked++;
  }
  assert.equal(checked,30);
});
test("sphere edge is stable, outside pixels are rejected and the far side is hidden",()=>{
  const camera={latitude:0,longitude:0};
  const edge=pickGlobePoint(geometry.centerX+geometry.radius,geometry.centerY,camera,geometry)!;
  near(edge.latitude,0);near(edge.longitude,90);
  assert.equal(pickGlobePoint(geometry.centerX+geometry.radius+.01,geometry.centerY,camera,geometry),null);
  assert.equal(pickGlobePoint(-1,300,camera,geometry),null);
  assert.equal(pickGlobePoint(10,10,camera,globeGeometry(0,0)),null);
  assert.equal(pickGlobePoint(NaN,10,camera,geometry),null);
  const back=projectPoint({latitude:0,longitude:180},camera,geometry);
  assert.equal(back.visible,false);near(back.depth,-1);
  near(pickGlobePoint(back.x,back.y,camera,geometry)!.longitude,0);
});
test("drag follows the hand, clamps the poles and cannot trigger an accidental click",()=>{
  const camera={latitude:0,longitude:0};
  const next=dragGlobe(camera,30,0,geometry.radius);
  assert.ok(projectPoint({latitude:0,longitude:0},next,geometry).x>geometry.centerX);
  assert.equal(dragGlobe(camera,0,10000,geometry.radius).latitude,85);
  assert.equal(dragGlobe(camera,0,-10000,geometry.radius).latitude,-85);
  assert.deepEqual(dragGlobe(camera,30,30,0),camera);
  assert.equal(isGlobeClick(6),true);assert.equal(isGlobeClick(6.01),false);assert.equal(isGlobeClick(-1),false);assert.equal(isGlobeClick(NaN),false);
  assert.equal(isGlobeClick(Math.max(20,0)),false); // dragging away and back is still a drag
});
test("region camera transitions take the short route through 180 degrees",()=>{
  const from={latitude:20,longitude:179},to={latitude:40,longitude:-179};
  const middle=interpolateCamera(from,to,.5);
  near(middle.latitude,30);near(Math.abs(middle.longitude),180);
  assert.deepEqual(interpolateCamera(from,to,1),to);
  assert.deepEqual(interpolateCamera(from,to,0),from);
  const basis=cameraBasis(middle);
  for(const axis of Object.values(basis)) near(Math.hypot(...axis),1);
});
test("cached NASA source files retain their recorded bytes and SHA-256 under 3 MB",async()=>{
  const directory=new URL("../public/images/globe/",import.meta.url);
  const manifest=JSON.parse(await readFile(new URL("provenance.json",directory),"utf8"));
  let total=0;
  for(const asset of manifest.assets) {
    const data=await readFile(new URL(asset.file,directory));
    assert.equal(data.length,asset.bytes);assert.equal(createHash("sha256").update(data).digest("hex"),asset.sha256);
    assert.match(asset.request,/^https:\/\/(svs|eoimages)\.gsfc\.nasa\.gov\//);
    assert.ok(asset.credit);assert.equal(asset.sourceObservationDate,null);total+=data.length;
  }
  assert.equal(manifest.assets.length,3);assert.ok(total<3_000_000);
});
