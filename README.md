# Doxo — L’atelier PDF

Éditeur PDF en français pour modifier, annoter et organiser vos documents directement dans votre navigateur.

## Application

**[Ouvrir Doxo →](https://nougrr.github.io/doxo/)**

Un éditeur PDF gratuit, sans compte, qui traite vos documents sur votre appareil.

## Utiliser en local

Télécharger ce dépôt, extraire son contenu, puis **ouvrir `index.html` dans un navigateur récent** (Chrome, Edge, Firefox, Safari ou Opera). Conserver le dossier `vendor/` à côté du fichier. Aucun serveur local, aucune installation et aucune compilation ne sont nécessaires. Les bibliothèques, polices et ressources PDF sont incluses pour fonctionner hors ligne.

## Modifier un PDF

1. Ouvrir le PDF avec **Ouvrir un PDF** ou le glisser dans l’espace central.
2. Choisir **Modifier**, cliquer sur un bloc de texte encadré, modifier son contenu dans le panneau puis cliquer sur **Appliquer le texte**.
3. Dans le volet Pages, utiliser **＋ Page vierge** pour insérer une page après la page sélectionnée ou cliquer sur la **corbeille de sa miniature** pour la supprimer. Le PDF doit conserver au moins une page.
4. Cliquer sur **Exporter** pour télécharger le PDF modifié. Les actions peuvent être annulées avec la flèche ↶.

## Fonctionnalités

- Import de PDF par sélection ou glisser-déposer, document de démonstration.
- Remplacement visuel des blocs de texte détectés dans les PDF existants (outil Modifier).
- Ajout de textes multilignes, taille, gras et couleur.
- Dessin libre, surlignage transparent, rectangles, images PNG/JPEG.
- Sélection, déplacement et suppression des annotations.
- Ajout de pages vierges au format de la page courante, rotation, déplacement et suppression de pages.
- Annuler/rétablir, zoom, ajustement à l’écran.
- Export PDF qui conserve les pages d’origine et ajoute les annotations en surimpression.
- Interface adaptée aux écrans mobiles, libellés accessibles, raccourcis clavier.

L’outil Modifier détecte les blocs de texte horizontaux et les remplace visuellement sur un fond uni ajustable. Les polices sont substituées par Arial ; les fonds complexes, les textes inclinés et les scans nécessitent une autre approche ou un OCR. Les pages dont le texte existant est modifié sont entièrement aplaties en image à l’export : le texte d’origine n’est plus conservé comme texte caché, mais ces pages perdent leurs textes sélectionnables, liens et champs interactifs. Les annotations sont intégrées sous forme d’image transparente à l’export ; elles ne restent pas des objets éditables séparément après réimport. Les pages sans remplacement de texte conservent leur contenu PDF d’origine vectoriel. Il n’y a ni OCR, ni outil de caviardage sécurisé, ni signature cryptographique. Les documents chiffrés doivent être déverrouillés avant import. Les modifications restent en mémoire jusqu’à l’export ; un avertissement protège contre une fermeture accidentelle.

Les fichiers restent dans le navigateur. Les bibliothèques sont incluses dans `vendor/` : aucun CDN ou service tiers n’est appelé au chargement de l’application.

## Raccourcis

`E` modifier le texte existant · `V` sélection · `T` texte · `D` dessin · `H` surlignage · `R` rectangle · `Suppr` supprimer l’annotation · `Échap` désélectionner · `⌘/Ctrl Z` annuler · `⌘/Ctrl Maj Z` rétablir · `⌘/Ctrl S` exporter.

## Bibliothèques

- PDF.js 3.11.174 — Apache-2.0, rendu des documents.
- pdf-lib 1.17.1 — MIT, manipulation et export.

Voir les licences dans `vendor/`.

## Publication

Le site statique est publié sur GitHub Pages par [le workflow de déploiement](.github/workflows/pages.yml) à chaque push sur `main`.

- Dépôt : [NouGrr/doxo](https://github.com/NouGrr/doxo)
- Application : [nougrr.github.io/doxo](https://nougrr.github.io/doxo/)
- Hébergement : GitHub Pages ; traitement des documents : dans votre navigateur.
