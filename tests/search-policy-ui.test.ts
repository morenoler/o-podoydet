import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Hotel, HotelMatch, Trip } from "../shared/types";
import type { AdvisorRun } from "../shared/advisor";
import { restoreSearchTrip, normalizeSearchTrip, listLimitForSelection } from "../src/features/search/searchPolicy";
import { AdmissionModePicker } from "../src/features/search/AdmissionModePicker";
import { SearchFilters } from "../src/features/search/SearchFilters";
import { advisorTripKey } from "../src/features/advisor/useAdvisor";
import { AdvisorReportView } from "../src/features/advisor/AdvisorReportView";
import { FavoritesTestProvider as FavoritesProvider } from "./helpers/favoritesTestProvider";
import { featureIds } from "../shared/features";
import { HotelCard } from "../src/features/hotels/components/HotelCard";
import { MatchBadge } from "../src/features/hotels/components/MatchBadge";
import { WishMatches } from "../src/features/hotels/components/WishMatches";

const trip: Trip = {region:"Пусан",checkIn:"2027-06-01",checkOut:"2027-06-04",adults:2,children:0,scenarios:[],preferences:[],text:""};
const hotel: Hotel = {id:"fixture",name:"Fixture",address:"Пусан",coordinates:[129.16,35.16],osmUrl:"",route:null,noise:[],rooms:[
  {id:"category",name:"Family twin",scope:"room_category",capacity:3,evidenceStatus:"verified",demo:false}
]};
const criterion: HotelMatch["best"]["criteria"][number] = {feature:"courtyard",required:true,status:"mismatch",evidenceStatus:"unknown",assumed:true,decisionBasis:"estimate",facts:[],explanation:"Окна неизвестны",sourceExplanation:"Нет данных"};
function match(provisional:boolean, required = true): HotelMatch {
  const best: HotelMatch["best"] = {room:hotel.rooms[0],status:"fits",provisional,score:0,criteria:[{...criterion,required}],capacityStatus:"match",capacityEvidenceStatus:"match",capacityAssumed:false};
  return {hotel,best,rooms:[best]};
}
function card(value:HotelMatch) {
  return renderToStaticMarkup(createElement(MemoryRouter,null,createElement(FavoritesProvider,null,createElement(HotelCard,{match:value}))));
}

test("UI migrates old saved trips to explore and preserves only supported admission modes", () => {
  for (const saved of [null, [], {...trip}, {...trip,admissionMode:"future"}, {...trip,admissionMode:null}]) {
    assert.equal(restoreSearchTrip(saved,trip).admissionMode,"explore");
  }
  const old = {...trip,children:2,preferences:[{feature:"family" as const,required:true}]};
  assert.deepEqual(restoreSearchTrip(old,trip),{...old,admissionMode:"explore"});
  assert.equal(restoreSearchTrip({...old,admissionMode:"verified"},trip).admissionMode,"verified");
  assert.equal(normalizeSearchTrip(trip).admissionMode,"explore");
  assert.equal(trip.admissionMode,undefined,"normalization does not mutate legacy API inputs");
});

test("mode choice has a labelled radio group and distinguishes missing evidence from contradiction", () => {
  const html=renderToStaticMarkup(createElement(AdmissionModePicker,{value:undefined,onChange:()=>{}}));
  assert.match(html,/<legend>Как отбирать варианты<\/legend>/);
  assert.match(html,/checked="" value="explore"/);
  assert.match(html,/Без известных препятствий/);
  assert.match(html,/Только подтверждённые/);
  assert.match(html,/противоречия в обязательных условиях исключаем/);
});

test("filters explain optional priority and expose amenities and evidence criteria in named groups", () => {
  const html=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(SearchFilters,{trip:{...trip,preferences:[{feature:"family",required:false}]},onApply:()=>{},onClose:()=>{}})));
  for (const label of ["В номере", "В отеле", "С питомцем", "Пляж и дорога","Номер и размещение","Окружение","Желательно · влияет на порядок","Применить","Сбросить"]) assert.ok(html.includes(label),label);
  assert.equal((html.match(/class="preference-button"/g)||[]).length,featureIds.length);
  assert.match(html,/«Желательно» влияет на порядок/);
});

test("selecting any of 96 map markers reveals its card without truncating or resetting the list", () => {
  const hotels=Array.from({length:96},(_,i)=>({...hotel,id:`hotel-${i}`}));
  for(let i=0;i<96;i++) {
    const limit=listLimitForSelection(hotels,8,`hotel-${i}`);
    assert.ok(limit>i,`card ${i} must become visible`);
    assert.ok(limit>=8 && limit<=96);
  }
  assert.equal(listLimitForSelection(hotels,48,"hotel-1"),48);
  assert.equal(listLimitForSelection(hotels,8,"missing"),8);
});

test("advisor snapshot identity changes with admission mode and keeps legacy API omission strict", () => {
  assert.notEqual(advisorTripKey({...trip,admissionMode:"explore"}),advisorTripKey({...trip,admissionMode:"verified"}));
  assert.equal(advisorTripKey(trip),advisorTripKey({...trip,admissionMode:"verified"}));
});

test("provisional admission is explicit across cards and badges without confirming unknown evidence", () => {
  const provisional=match(true);
  assert.match(card(provisional),/Вариант для уточнения/);
  assert.doesNotMatch(card(provisional),/Подходит под фильтры/);
  const priced={...provisional,hotel:{...hotel,pricePerNight:100000,currency:"KRW" as const}};
  assert.match(card(priced),/Вариант для уточнения/);
  assert.match(card(priced),/₩/);
  const badge=renderToStaticMarkup(createElement(MatchBadge,{match:provisional}));
  assert.match(badge,/match-badge unknown/);
  assert.match(badge,/Вариант для уточнения/);
  const wishes=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(WishMatches,{criteria:provisional.best.criteria})));
  assert.match(wishes,/Совпало 0 из 1/);
  assert.doesNotMatch(wishes,/Обязательные условия выполнены/);
  const optional=card(match(false,false));
  assert.match(optional,/Есть условия для уточнения/);
  assert.doesNotMatch(optional,/Вариант для уточнения/);
});

test("cards use sourced category metadata and omit repeated empty floor and direction fields", () => {
  const preview=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(FavoritesProvider,null,createElement(HotelCard,{hotel}))));
  assert.match(preview,/Категории с официального сайта: 1/);
  assert.match(preview,/search-hotel-result is-preview/);
  assert.doesNotMatch(preview,/Категория: Family twin|Категорию и условия номера нужно уточнить/);
  const html=card(match(false,false));
  assert.match(html,/Категория: Family twin · до 3 гостей/);
  assert.doesNotMatch(html,/Этаж: Не указано|Окна: Не указано/);
  const conditional=match(false,false);
  conditional.best.room={...conditional.best.room,capacityMayVary:true};
  assert.doesNotMatch(card(conditional),/· до 3 гостей/);
  const unknown=match(true);
  unknown.best.room={...unknown.best.room,evidenceStatus:"unknown",scope:"unknown"};
  assert.doesNotMatch(card(unknown),/Категория: Family twin/);
});

test("advisor provisional cards and even legacy positive unknown evidence cannot claim confirmation", () => {
  const run:AdvisorRun={id:"run",mode:"rules",status:"completed",createdAt:"2026-10-25T12:00:00Z",updatedAt:"2026-10-25T12:00:00Z",events:[],modelCalls:0,inputTokens:0,outputTokens:0,warnings:[],context:{
    searchId:"search",trip:{...trip,admissionMode:"explore"},preferences:[],totalHotels:1,fitCount:1,conflicts:[],warnings:[],scenarios:[],questions:[],generatedAt:"2026-10-25T12:00:00Z",candidates:[{
      id:"candidate",hotelId:hotel.id,hotelName:hotel.name,roomId:"category",roomName:"Family twin",status:"fits",provisional:true,score:0,criteria:[{
        id:"evidence",feature:"courtyard",label:"Окна во двор",required:true,status:"match",evidenceStatus:"unknown",assumed:false,explanation:"Нет данных",sources:[]
      }]
    }]
  },report:{outcome:"shortlist",summary:"Нужно уточнить окна",candidateIds:["candidate"],scenarioIds:[],questionId:null,cautions:[],nextSteps:[]}};
  const html=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(AdvisorReportView,{run})));
  assert.match(html,/advisor-provisional/);
  assert.match(html,/Вариант для уточнения/);
  assert.match(html,/Требует уточнения/);
  assert.doesNotMatch(html,/Прошёл текущие условия|Условие выполнено/);
});
