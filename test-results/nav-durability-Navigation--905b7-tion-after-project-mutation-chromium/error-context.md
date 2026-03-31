# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e3]:
    - complementary [ref=e4]:
      - button "SYNAPSE" [ref=e5]
      - navigation [ref=e6]:
        - button "⌂ Home" [ref=e7]:
          - generic [ref=e8]: ⌂
          - text: Home
        - button "◎ Explore" [ref=e9]:
          - generic [ref=e10]: ◎
          - text: Explore
        - button "⬛ Projects" [ref=e11]:
          - generic [ref=e12]: ⬛
          - text: Projects
        - button "▶ Studio" [ref=e13]:
          - generic [ref=e14]: ▶
          - text: Studio
        - button "◈ Niche" [ref=e15]:
          - generic [ref=e16]: ◈
          - text: Niche
        - button "⟐ Login" [ref=e17]:
          - generic [ref=e18]: ⟐
          - text: Login
    - main [ref=e19]:
      - generic [ref=e20]:
        - img [ref=e21]
        - generic [ref=e23]:
          - heading "No Project Open" [level=2] [ref=e24]
          - paragraph [ref=e25]: Create a new project to begin editing
        - button "Create New Project" [ref=e26]:
          - img [ref=e27]
          - text: Create New Project
  - button "Open Next.js Dev Tools" [ref=e33] [cursor=pointer]:
    - img [ref=e34]
  - alert [ref=e37]
```