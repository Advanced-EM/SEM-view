# Find the second crossover E2 of an uncoated insulator: step the voltage down until it stops charging.
import semview as sv

sem = sv.connect()
sem.challenge("sem-insulator", seed=7)      # an alumina inclusion whose true E2 is hidden
for kV in [15, 10, 7, 5, 4, 3.5, 3, 2.7, 2.4, 2.1, 1.8, 1.5]:
    sem.set(kV=kV)
    sem.acquire()
    charging = sem.state()["charging"]
    print(f"{kV:5.1f} kV  {'charging' if charging else 'stable'}")
    if not charging:
        break
print("score:", sem.score())
print("truth:", sem.reveal())
sem.end_challenge()
