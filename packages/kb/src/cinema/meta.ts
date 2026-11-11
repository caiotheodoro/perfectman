import type { CineGenre } from "./types.js";

/** Genre bucket per stage text (file stem) and per TV show (name before the episode code). Hand-assigned, one reading each: a tragedy with a killing is "drama" here, farces and comedies of manners are "comedy". */
export const PLAY_GENRE: Record<string, CineGenre> = {
  "a-dolls-house": "drama", "hedda-gabler": "drama", ghosts: "drama", "the-wild-duck": "drama", "the-master-builder": "drama", "uncle-vanya": "drama", "the-father": "drama",
  "the-importance-of-being-earnest": "comedy", "an-ideal-husband": "comedy", "doctor-faustus": "drama", "cyrano-de-bergerac": "drama", tartuffe: "comedy", "riders-to-the-sea": "drama", "playboy-of-the-western-world": "comedy",
  othello: "thriller", "romeo-and-juliet": "drama", macbeth: "thriller", hamlet: "thriller", "king-lear": "drama", "julius-caesar": "thriller", "much-ado-about-nothing": "comedy", "a-midsummer-nights-dream": "comedy",
  "the-taming-of-the-shrew": "comedy", "antony-and-cleopatra": "drama", "titus-andronicus": "thriller", "the-winters-tale": "drama",
  "pena-o-juiz-de-paz-na-roca": "comedy", "pena-quem-casa-quer-casa": "comedy", "pena-os-irmaos-das-almas": "drama", "pena-o-namorador": "comedy", "vicente-auto-da-barca-do-inferno": "comedy",
  "alencar-o-demonio-familiar": "comedy", "alencar-as-asas-de-um-anjo": "drama", "alencar-mae": "drama", "dias-leonor-de-mendonca": "drama", "garrett-frei-luis-de-sousa": "drama", "machado-o-caminho-da-porta": "comedy",
  "azevedo-a-pele-do-lobo": "comedy", "azevedo-uma-vespera-de-reis": "comedy", "franca-junior-maldita-parentela": "comedy", "franca-junior-ingleses-na-costa": "comedy", "franca-junior-o-defeito-de-familia": "comedy",
  "qorpo-santo-mateus-e-mateusa": "comedy",
  // added 2026-11-11: gutenberg-plays-2 and pt-plays-wikisource
  "azevedo-a-casadinha-de-fresco": "comedy", "azevedo-a-princesa-dos-cajueiros": "comedy", "pena-as-casadas-solteiras": "comedy", "vicente-farsa-de-ines-pereira": "comedy", "macedo-luxo-e-vaidade": "comedy", "azevedo-nova-viagem-a-lua": "comedy", "azevedo-o-califa-da-rua-do-sabao": "comedy", "macedo-o-credito": "drama", "azevedo-o-dote": "comedy", "azevedo-o-escravocrata": "drama", "azevedo-o-mambembe": "comedy", "alencar-os-lobisomens": "drama", "azevedo-os-noivos": "drama", "azevedo-romance-de-uma-velha": "comedy", "azevedo-amor-com-amor-se-paga": "comedy", "qorpo-santo-as-relacoes-naturais": "comedy", "vicente-auto-da-alma": "drama", "pena-o-diletante": "comedy", "azevedo-o-liberato": "comedy", "vicente-o-velho-da-horta": "comedy", "pena-os-ciumes-de-um-pedestre": "comedy", "qorpo-santo-um-assovio": "comedy", "pygmalion": "comedy", "mrs-warrens-profession": "drama", "major-barbara": "drama", "strife": "drama", "the-rivals": "comedy", "she-stoops-to-conquer": "comedy", "lady-windermeres-fan": "comedy", "a-woman-of-no-importance": "comedy", "arms-and-the-man": "comedy", "man-and-superman": "comedy", "an-enemy-of-the-people": "drama", "creditors-pariah": "drama", "ivanoff": "drama", "qorpo-santo-um-parto": "comedy", "pena-o-judas-em-sabado-de-aleluia": "comedy",
};

const T = "thriller", C = "comedy", D = "drama";
export const SHOW_GENRE: Record<string, CineGenre> = {
  Doctor_Who_1963: T, Doctor_Who: T, Alias: T, CSI__Crime_Scene_Investigation: T, CSI__Cyber: T, Bones: T, NCIS: T, NCIS__Los_Angeles: T, Justified: T, The_Mentalist: T, Veronica_Mars: T, True_Blood: T, Torchwood: T,
  Hannibal: T, Dexter: T, Salem: T, The_Vampire_Diaries: T, Buffy_the_Vampire_Slayer: T, Angel: T, Charmed: T, The_Walking_Dead: T, The_100: T, The_X_Files: T, "The_X-Files": T, Westworld: T, Vikings: T, Game_of_Thrones: T,
  Teen_Wolf: T, The_Originals: T, Lucifer: T, Arrow: T, Pretty_Little_Liars: T, "Hawaii_Five-0": T, Hell_on_Wheels: T, London_Spy: T, Blood_Feuds: T, Tyrant: T, Roswell: T, The_4400: T, Mars: T, Once_Upon_A_Time: T, Merlin: T, Reign: D,
  American_Horror_Story: T, Haunted_Case_Files: T, Bull: T, The_Brokenwood_Mysteries: T, Nowhere_Boys: T, Mr_Robot: T,
  Frasier: C, FRIENDS: C, The_Office: C, The_Big_Bang_Theory: C, How_I_Met_Your_Mother: C, Childrens_Hospital: C, Schitt_s_Creek: C, Trailer_Park_Boys: C, Married: C, You_re_the_Worst: C, New_Girl: C, The_League: C,
  Rick_and_Morty: C, Glee: C, Greek: C, My_Little_Pony__Friendship_is_Magic: C, We_Bare_Bears: C, Bunk_d: C, Almost_Royal: C, Sally4Ever: C, The_Comeback: C, High_Maintenance: C, Girl_Meets_World: C, The_Grand_Tour: C,
  Gilmore_Girls: D, One_Tree_Hill: D, Dawson_s_Creek: D, Degrassi_Next_Generation: D, "The_O.C.": D, Grey_s_Anatomy: D, Queer_As_Folk: D, The_L_Word: D, Downton_Abbey: D, Heartland: D, Gossip_Girl: D, Friday_Night_Lights: D,
  Scandal: D, The_Good_Wife: D, All_American: D, Open_Heart: D, House: D,
};

export const showOf = (fileName: string): string => fileName.replace(/_\d+x\d+.*$/, "").replace(/\.json$/, "");
